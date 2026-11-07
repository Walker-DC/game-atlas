#!/usr/bin/env python3
"""APK/XAPK/APKS를 풀어 분석 에이전트가 읽을 수 있는 형태로 정리한다.

사용법: python3 apk_추출.py <apk·xapk·apks 또는 OBB 파일...> <출력폴더>

출력:
  요약.md            엔진, 패키지, SDK, 데이터 파일 위치, 암호화 추정, 다음 할 일
  파일목록.csv        원본 안의 모든 파일(경로, 크기, 확장자)
  데이터/             읽을 수 있는 데이터 파일(json/csv/xml/lua/txt 등) 원본 경로 그대로
  unity_textasset/   Unity TextAsset(UnityPy가 있을 때만)
  문자열_한글.txt      전체에서 뽑은 한글 문자열(UI 텍스트 → 시스템 이름 파악용)
  문자열_코드.txt      IL2CPP 메타데이터·DEX의 식별자(클래스·메서드명)
  상품ID_후보.txt     결제 상품 ID처럼 보이는 문자열
원본 파일은 읽기만 한다.
"""
import csv
import io
import math
import os
import re
import struct
import sys
import zipfile
from collections import Counter, defaultdict

TEXT_EXT = {'.json', '.csv', '.tsv', '.xml', '.lua', '.txt', '.yaml', '.yml', '.ini', '.cfg', '.properties', '.js', '.toml', '.tbl', '.sql'}
MAX_TEXT_FILE = 30 * 1024 * 1024
ENGINE_HINTS = [
    ('Unity IL2CPP', lambda n: n.endswith('libil2cpp.so') or n.endswith('global-metadata.dat')),
    ('Unity Mono', lambda n: n.endswith('libmonobdwgc-2.0.so') or n.endswith('libmono.so') or '/Managed/' in n and n.endswith('.dll')),
    ('Unreal', lambda n: n.endswith('libUE4.so') or n.endswith('libUnreal.so') or n.endswith('.pak')),
    ('Cocos', lambda n: 'libcocos' in n or n.endswith('.jsc') or n.endswith('.luac')),
    ('Flutter', lambda n: 'flutter_assets/' in n),
    ('Godot', lambda n: n.endswith('libgodot_android.so') or n.endswith('.pck')),
]
SDK_PREFIXES = {
    'com/android/billingclient': 'Google Play Billing', 'com/google/firebase': 'Firebase', 'com/appsflyer': 'AppsFlyer',
    'com/adjust/sdk': 'Adjust', 'io/airbridge': 'Airbridge', 'com/singular': 'Singular', 'com/facebook': 'Facebook SDK',
    'com/navercorp/nng': 'NAVER Game(라운지)', 'com/naver': 'NAVER', 'com/kakao': 'Kakao', 'com/hive': 'Hive(컴투스)',
    'com/netmarble': 'Netmarble', 'com/nexon': 'Nexon', 'com/ncsoft': 'NCSOFT', 'com/igaworks': 'IGAWorks',
    'com/tapjoy': 'Tapjoy', 'com/unity3d/ads': 'Unity Ads', 'com/applovin': 'AppLovin', 'com/ironsource': 'ironSource',
    'com/google/android/gms/ads': 'AdMob', 'com/onestore': 'ONE store', 'com/gaa/sdk': 'ONE store IAP',
    'com/samsung/android/sdk/iap': 'Galaxy Store IAP', 'com/xsolla': 'Xsolla', 'com/gamania': 'Gamania',
    'com/tencent': 'Tencent', 'com/bytedance': 'ByteDance', 'com/vng': 'VNG', 'com/gamebase': 'NHN Gamebase', 'com/toast': 'NHN TOAST',
}
HANGUL = re.compile(r'[가-힣][가-힣\w %{}\[\]()0-9.,!?:/~+\-·]{1,120}')
PRODUCT_ID = re.compile(r'\b(?:[a-z][a-z0-9_]*\.){2,}[a-z0-9_]*(?:pkg|pack|package|gem|dia|diamond|crystal|ruby|gold|coin|pass|month|monthly|vip|shop|product|item|bundle|iap)[a-z0-9_]*\b', re.I)


def entropy(b):
    if not b:
        return 0.0
    c = Counter(b)
    n = len(b)
    return -sum(v / n * math.log2(v / n) for v in c.values())


def ascii_strings(b, minlen=5):
    return re.findall(rb'[A-Za-z_][A-Za-z0-9_.$<>`]{%d,200}' % (minlen - 1), b)


def utf8_hangul(b):
    try:
        s = b.decode('utf-8', errors='ignore')
    except Exception:
        return []
    return [m.strip() for m in HANGUL.findall(s) if len(m.strip()) >= 2]


def dex_strings(b):
    """DEX string_ids 테이블에서 문자열을 읽는다."""
    try:
        size, off = struct.unpack_from('<II', b, 0x38)
        res = []
        for i in range(size):
            (soff,) = struct.unpack_from('<I', b, off + i * 4)
            p = soff
            while b[p] & 0x80:  # uleb128 길이 건너뛰기
                p += 1
            p += 1
            e = b.index(b'\x00', p)
            res.append(b[p:e].decode('utf-8', errors='ignore'))
        return res
    except Exception:
        return [s.decode('ascii', 'ignore') for s in ascii_strings(b)]


def axml_strings(b):
    """바이너리 AndroidManifest.xml의 문자열 풀."""
    try:
        (count,) = struct.unpack_from('<I', b, 16)
        flags, sstart = struct.unpack_from('<II', b, 24)
        utf8 = flags & 0x100
        base = 8 + sstart
        res = []
        for i in range(count):
            (o,) = struct.unpack_from('<I', b, 36 + i * 4)
            p = base + o
            if utf8:
                p += 2 if b[p] & 0x80 else 1
                n = b[p]
                if n & 0x80:
                    n = ((n & 0x7f) << 8) | b[p + 1]
                    p += 1
                p += 1
                res.append(b[p:p + n].decode('utf-8', 'ignore'))
            else:
                (n,) = struct.unpack_from('<H', b, p)
                res.append(b[p + 2:p + 2 + n * 2].decode('utf-16-le', 'ignore'))
        return res
    except Exception:
        return []


def iter_entries(path):
    """apk/xapk/apks/zip-obb 안의 (경로, 바이트로더, 크기) — 중첩 apk도 푼다."""
    def walk(zf, prefix):
        for info in zf.infolist():
            if info.is_dir():
                continue
            name = info.filename
            low = name.lower()
            if low.endswith(('.apk', '.obb')) or (low.endswith('.zip') and prefix == ''):
                try:
                    inner = zipfile.ZipFile(io.BytesIO(zf.read(name)))
                    yield from walk(inner, prefix + name + '!/')
                    continue
                except zipfile.BadZipFile:
                    pass
            yield prefix + name, (lambda zf=zf, name=name: zf.read(name)), info.file_size
    try:
        zf = zipfile.ZipFile(path)  # Unity 파일을 나중에 다시 읽으므로 열어 둔다
        yield from walk(zf, os.path.basename(path) + '!/')
    except zipfile.BadZipFile:
        yield os.path.basename(path), (lambda: open(path, 'rb').read()), os.path.getsize(path)


def main():
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(1)
    inputs, out = sys.argv[1:-1], sys.argv[-1]
    os.makedirs(os.path.join(out, '데이터'), exist_ok=True)

    rows, engines, sdks = [], set(), set()
    ext_count, ext_size = Counter(), Counter()
    hangul, code_ids, product_ids, manifest = Counter(), set(), set(), []
    data_saved, encrypted_suspects, unity_files = [], [], []

    for src in inputs:
        for name, load, size in iter_entries(src):
            rows.append((name, size))
            base = name.split('!/')[-1]
            ext = os.path.splitext(base)[1].lower() or '(없음)'
            ext_count[ext] += 1
            ext_size[ext] += size
            for eng, test in ENGINE_HINTS:
                if test(name):
                    engines.add(eng)

            if base == 'AndroidManifest.xml':
                manifest += axml_strings(load())
            elif name.count('!/') == 1 and base == 'manifest.json':  # XAPK
                m = re.search(r'"package_name"\s*:\s*"([^"]+)"', load().decode('utf-8', 'ignore'))
                if m:
                    manifest.insert(0, m.group(1))
            elif base.endswith('.dex'):
                strs = dex_strings(load())
                for s in strs:
                    if s.startswith('L') and s.endswith(';'):
                        path_ = s[1:-1]
                        for pre, sdk in SDK_PREFIXES.items():
                            if path_.startswith(pre):
                                sdks.add(sdk)
                    product_ids.update(m.group() for m in PRODUCT_ID.finditer(s))
                    if re.search(r'[가-힣]', s):
                        hangul[s.strip()] += 1
            elif base.endswith('global-metadata.dat'):
                b = load()
                code_ids.update(x.decode('ascii', 'ignore') for x in ascii_strings(b, 4))
                for s in utf8_hangul(b):
                    hangul[s] += 1
            elif ext in TEXT_EXT and size <= MAX_TEXT_FILE:
                b = load()
                dst = os.path.join(out, '데이터', re.sub(r'[!:*?"<>|]', '_', name))
                os.makedirs(os.path.dirname(dst), exist_ok=True)
                with open(dst, 'wb') as f:
                    f.write(b)
                data_saved.append((name, size))
                for s in utf8_hangul(b):
                    hangul[s] += 1
                product_ids.update(m.group() for m in PRODUCT_ID.finditer(b.decode('utf-8', 'ignore')))
            elif ext in {'.bytes', '.dat', '.bin', '.db', '.sqlite', '.pb'} and size <= MAX_TEXT_FILE:
                b = load()
                head = b[:65536]
                if entropy(head) > 7.5:
                    encrypted_suspects.append((name, size))
                else:
                    dst = os.path.join(out, '데이터', re.sub(r'[!:*?"<>|]', '_', name))
                    os.makedirs(os.path.dirname(dst), exist_ok=True)
                    with open(dst, 'wb') as f:
                        f.write(b)
                    data_saved.append((name, size))
                    for s in utf8_hangul(b):
                        hangul[s] += 1
            if ('assets/bin/Data/' in name or base.endswith(('.bundle', '.ab', '.unity3d', '.assets')) or re.fullmatch(r'[0-9a-f]{32}', base) or base.startswith(('data.unity3d', 'sharedassets', 'resources.assets', 'globalgamemanagers'))) and size <= 400 * 1024 * 1024:
                unity_files.append((name, load))

    # Unity TextAsset (선택)
    unity_note = ''
    if 'Unity IL2CPP' in engines or 'Unity Mono' in engines:
        try:
            import UnityPy  # noqa
            ta_dir = os.path.join(out, 'unity_textasset')
            os.makedirs(ta_dir, exist_ok=True)
            n_ta = 0
            for name, load in unity_files:
                try:
                    env = UnityPy.load(load())
                except Exception:
                    continue
                for obj in env.objects:
                    if obj.type.name != 'TextAsset':
                        continue
                    try:
                        d = obj.read()
                        raw = d.m_Script
                        b = raw.encode('utf-8', 'surrogateescape') if isinstance(raw, str) else bytes(raw)
                        fn = re.sub(r'[\\/:*?"<>|]', '_', getattr(d, 'm_Name', None) or getattr(d, 'name', 'noname'))
                        with open(os.path.join(ta_dir, f'{fn}.txt'), 'wb') as f:
                            f.write(b)
                        n_ta += 1
                        for s in utf8_hangul(b):
                            hangul[s] += 1
                    except Exception:
                        continue
            unity_note = f'UnityPy로 TextAsset {n_ta}개 추출 → unity_textasset/'
        except ImportError:
            unity_note = 'UnityPy 미설치 — `python3 -m pip install --user UnityPy` 후 다시 실행하면 Unity TextAsset(게임 테이블)을 뽑을 수 있음'

    with open(os.path.join(out, '파일목록.csv'), 'w', newline='', encoding='utf-8-sig') as f:
        w = csv.writer(f)
        w.writerow(['경로', '크기(byte)'])
        w.writerows(sorted(rows))
    with open(os.path.join(out, '문자열_한글.txt'), 'w', encoding='utf-8') as f:
        for s, _ in sorted(hangul.items(), key=lambda kv: (-kv[1], kv[0])):
            f.write(s.replace('\n', ' ') + '\n')
    with open(os.path.join(out, '문자열_코드.txt'), 'w', encoding='utf-8') as f:
        f.write('\n'.join(sorted(code_ids)))
    with open(os.path.join(out, '상품ID_후보.txt'), 'w', encoding='utf-8') as f:
        f.write('\n'.join(sorted(product_ids)))

    # 패키지명: 소문자 점 표기 후보 중, 다른 매니페스트 문자열(액티비티·프로바이더 authority 등)의 접두어로 가장 많이 쓰이는 것
    lib_prefixes = ('android.', 'androidx.', 'com.google.', 'com.android.', 'kotlin', 'org.apache.', 'java.')
    cands = [s for s in manifest if re.fullmatch(r'[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*){1,}', s) and not s.startswith(lib_prefixes)]
    pkg = max(cands, key=lambda c: (sum(1 for t in manifest if (c + '.') in t), -cands.index(c)), default='(못 찾음)')
    perms = sorted({s for s in manifest if s.startswith('android.permission.') or '.permission.' in s})
    keywords = ['가챠', '뽑기', '소환', '강화', '거래소', '경매', '공성', '점령', '길드', '혈맹', '패스', '월정액', '멤버십', 'VIP', '천장', '확정', '변신', '탈것', '펫', '컬렉션', '도감', '각인', '룬', '어비스', '레이드', '보스', '랭킹', 'PvP', '결투', '시즌', '출석', '상점', '다이아', '골드',
                '연맹', '진영', '행군', '가속', '건설', '방치', '스테이지', '스태미나', '광고', '월간 카드', '기금', '픽업', '확률', '합성', '승급', '각성']
    kw_hits = {k: sum(1 for s in hangul if k in s) for k in keywords}
    total = sum(s for _, s in rows)

    L = [f'# APK 추출 요약', '', f'- 원본: {", ".join(os.path.basename(i) for i in inputs)}',
         f'- 패키지: {pkg}', f'- 엔진: {", ".join(sorted(engines)) or "판별 못함"}',
         f'- 파일 {len(rows):,}개, 합계 {total / 1024 / 1024:,.1f}MB',
         f'- SDK: {", ".join(sorted(sdks)) or "(DEX에서 못 찾음)"}',
         f'- 데이터 파일 저장: {len(data_saved)}개 → 데이터/', f'- 한글 문자열: {len(hangul):,}개 → 문자열_한글.txt',
         f'- 코드 식별자: {len(code_ids):,}개 → 문자열_코드.txt', f'- 상품 ID 후보: {len(product_ids)}개 → 상품ID_후보.txt']
    if unity_note:
        L.append(f'- {unity_note}')
    L += ['', '## 확장자별', '| 확장자 | 개수 | 크기(MB) |', '| --- | ---: | ---: |']
    L += [f'| {e} | {c} | {ext_size[e] / 1024 / 1024:,.1f} |' for e, c in ext_count.most_common(25)]
    L += ['', '## 시스템 키워드 (한글 문자열 안 등장 수 — 0이면 없거나 암호화/외부 다운로드)', '| 키워드 | 문자열 수 |', '| --- | ---: |']
    L += [f'| {k} | {v} |' for k, v in kw_hits.items()]
    L += ['', '## 큰 데이터 파일 상위 30', '| 경로 | KB |', '| --- | ---: |']
    L += [f'| {n} | {s / 1024:,.0f} |' for n, s in sorted(data_saved, key=lambda x: -x[1])[:30]]
    if encrypted_suspects:
        L += ['', f'## 암호화 추정 {len(encrypted_suspects)}개 (엔트로피 > 7.5, 저장 안 함)']
        L += [f'- {n} ({s / 1024:,.0f}KB)' for n, s in sorted(encrypted_suspects, key=lambda x: -x[1])[:30]]
    L += ['', '## 권한', *[f'- {p}' for p in perms[:40]]]
    L += ['', '## 읽는 순서 (에이전트용)',
          '1. 이 요약의 키워드 표로 어떤 시스템이 있는지 감을 잡는다.',
          '2. 문자열_한글.txt 에서 시스템·상품·재화 이름을 찾는다(UI 텍스트).',
          '3. 데이터/ · unity_textasset/ 의 테이블에서 수치(확률·비용·보상)를 확인한다.',
          '4. 문자열_코드.txt 에서 클래스명(예: *Gacha*, *Shop*, *Guild*)으로 시스템 존재를 교차 확인한다.',
          '5. 키워드가 거의 0이고 데이터가 적으면: 리소스가 설치 후 다운로드되는 구조이거나 암호화됨 — 근거는 "추정:"으로 쓴다.']
    with open(os.path.join(out, '요약.md'), 'w', encoding='utf-8') as f:
        f.write('\n'.join(L) + '\n')
    print('\n'.join(L[:12]))
    print(f'\n→ {os.path.join(out, "요약.md")}')


if __name__ == '__main__':
    main()

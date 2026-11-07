#!/usr/bin/env python3
"""PC 클라이언트 폴더(설치 완료본)를 읽어 분석 에이전트가 볼 수 있는 형태로 정리한다. (APK용 apk_추출.py의 PC판)

사용법: python3 pc_추출.py <클라이언트 폴더> <출력폴더>
출력: 요약.md, 파일목록.csv, 데이터/(텍스트류를 UTF-8로 변환한 사본), 문자열_중문.txt(실행 파일·DLL의 중국어 문자열),
      패키지_경로목록.txt(.dat 패키지 색인에서 뽑은 내부 경로), 패키지_분류.txt
원본은 읽기만 한다.
"""
import collections, csv, os, re, sys

TEXT_EXT = {'.xml', '.cfg', '.ini', '.txt', '.lua', '.csv', '.json'}
MAX_TEXT = 2 * 1024 * 1024
HAN = re.compile(rb'(?:[\xb0-\xf7][\xa1-\xfe]|[\x20-\x7e]){4,}')

def decode(b):
    for enc in ('utf-8-sig', 'gb18030', 'utf-16'):
        try: return b.decode(enc)
        except Exception: pass
    return b.decode('latin1')

def han_strings(path):
    b = open(path, 'rb').read()
    out = set()
    for m in re.finditer(rb'(?:[\x81-\xfe][\x40-\xfe]|[\x20-\x7e]){3,}', b):
        try: s = m.group().decode('gb18030')
        except Exception: continue
        h = len(re.findall(r'[\u4e00-\u9fff]', s))
        if h >= 3 and h / len(s) >= 0.5: out.add(s.strip())
    return sorted(out)

def package_paths(path):
    sz = os.path.getsize(path); n = min(sz, 64 * 1024 * 1024)
    with open(path, 'rb') as f:
        f.seek(sz - n); t = f.read(n)
    ps = re.findall(rb'[\x20-\x7e]{6,220}\.[A-Za-z0-9]{2,5}\x00', t)
    return sorted({p[:-1].decode() for p in ps if b'\\' in p or b'/' in p})

def main(src, dst):
    os.makedirs(os.path.join(dst, '데이터'), exist_ok=True)
    rows, ext = [], collections.Counter()
    pk, strs, copied = [], {}, 0
    for r, _, fs in os.walk(src):
        for fn in fs:
            p = os.path.join(r, fn); rel = os.path.relpath(p, src); sz = os.path.getsize(p)
            e = os.path.splitext(fn)[1].lower(); ext[e] += 1
            rows.append((rel, sz, e))
            if e in TEXT_EXT and sz <= MAX_TEXT:
                o = os.path.join(dst, '데이터', rel); os.makedirs(os.path.dirname(o), exist_ok=True)
                open(o, 'w', encoding='utf-8').write(decode(open(p, 'rb').read())); copied += 1
            if e == '.dat' and sz > 500 * 1024 * 1024: pk.append(p)
            if e in ('.exe', '.dll') and 100 * 1024 < sz < 80 * 1024 * 1024 and not re.match(r'(?i)(Setup|d3dx|dbghelp|fmod|rail_|steam|WebView2|MicrosoftEdge)', fn) and 'Setup' not in fn:
                strs[rel] = han_strings(p)
    with open(os.path.join(dst, '파일목록.csv'), 'w', newline='', encoding='utf-8') as f:
        w = csv.writer(f); w.writerow(['경로', '크기', '확장자']); w.writerows(rows)
    with open(os.path.join(dst, '문자열_중문.txt'), 'w', encoding='utf-8') as f:
        for k, v in strs.items():
            f.write(f'## {k} ({len(v)})\n' + '\n'.join(v) + '\n\n')
    allp = []
    for p in pk: allp += package_paths(p)
    open(os.path.join(dst, '패키지_경로목록.txt'), 'w', encoding='utf-8').write('\n'.join(allp))
    cat = collections.Counter('\\'.join(p.lower().replace('/', '\\').split('\\')[:2]) for p in allp)
    open(os.path.join(dst, '패키지_분류.txt'), 'w', encoding='utf-8').write('\n'.join(f'{v}\t{k}' for k, v in cat.most_common()))
    with open(os.path.join(dst, '요약.md'), 'w', encoding='utf-8') as f:
        f.write(f'# PC 클라이언트 추출 요약\n\n- 원본: {src}\n- 파일 {len(rows)}개, 텍스트 사본 {copied}개\n- 확장자: {dict(ext.most_common(15))}\n- 패키지 색인 경로 {len(allp)}개 (패키지 본문은 읽지 않음)\n')
    print('files', len(rows), 'text', copied, 'pkgpaths', len(allp), 'strfiles', {k: len(v) for k, v in strs.items()})

if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])

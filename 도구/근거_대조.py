"""분석 결과의 로컬 파일 근거를 원본과 기계적으로 대조한다 (에이전트 없음, 읽기 전용).

같은 모델끼리 분석하면 근거 위치를 지어내거나 행을 잘못 읽어도 서로 걸러내지 못한다.
이 스크립트는 결과 JSON(과 메인 세션이 쓴 판정 문서)에서 '파일명 L행 "인용"' 꼴 근거를 뽑아
실제 파일의 그 행과 대조한다. 외부 URL은 대조하지 않는다(워크플로우 사실 검증 몫).

사용:
  python3 도구/근거_대조.py <게임 폴더> <결과 json> [--doc 판정.md ...] [--out 근거대조.md]

검사:
  ① 행 없음      — 파일 길이를 넘는 행 번호
  ② 인용 불일치  — 인용 문구가 그 행(±1)에 없음. 같은 파일 다른 행에 있으면 그 위치를 알려 줌
  ③ 자리표시자 의심 — {0}·%s 같은 자리표시자 행을 근거로 수치를 주장함
  ④ 파일명 없음  — 'L123'만 있고 파일명이 없음(후보 파일 중 인용이 맞는 곳을 찾아 봄)
  ⑤ 근거 없는 문장 — --doc 문서의 목록 문장 중 근거·검증 표시(V번호·APK:·URL·추정·사내 확인)가 없는 것
"""
import argparse
import json
import os
import re
import sys

FILE_RE = r'(?P<file>[\w가-힣.\-/]+\.(?:txt|json|md|csv|tsv))'
LREF_RE = r'(?<![A-Za-z0-9])L(?P<a>\d{1,6})(?:\s*[~\-]\s*L?(?P<b>\d{1,6}))?'
QUOTE_RE = r'\s*(?:[:：]\s*)?(?P<q>"[^"\n]{2,120}"|\'[^\'\n]{2,120}\'|“[^”\n]{2,120}”|‘[^’\n]{2,120}’|「[^」\n]{2,120}」)'
TOKEN = re.compile(f'{FILE_RE}|{LREF_RE}(?:{QUOTE_RE})?')
PLACEHOLDER = re.compile(r'\{\d+\}|%[sd]|\{[a-zA-Z_]+\}')
NUM_UNIT = re.compile(r'\d+(?:\.\d+)?\s*(?:시간|분|초|일|주|개월|%|회|개|명|레벨|단계|배|원|위)')
TAG = re.compile(r'\bV\d+|APK:|https?://|추정|사내 확인|미확인|L\d+|\.txt|\.json')
ELLIPSIS = re.compile(r'\.{3}|…')
# 파일명과 행 번호 사이가 이만큼 떨어지거나 문장이 끊기면 그 파일의 행으로 보지 않는다
FILE_REACH = 60
BREAK = re.compile(r'[.。;)(\n]\s|[;\n]')


def norm(t):
    return re.sub(r'\s+', '', t).lower()


class Files:
    """게임 폴더 안 텍스트 파일을 이름으로 찾고 줄 단위로 읽어 둔다."""

    def __init__(self, home):
        self.home = home
        self.index = {}
        for root, _, names in os.walk(home):
            if os.sep + 'apk' in root or os.sep + '결과' in root:
                continue
            for n in names:
                if n.endswith(('.txt', '.json', '.md', '.csv', '.tsv')):
                    self.index.setdefault(n, []).append(os.path.join(root, n))
        self.cache = {}

    def find(self, name):
        base = os.path.basename(name)
        cands = self.index.get(base, [])
        exact = [c for c in cands if c.replace(os.sep, '/').endswith(name)]
        return (exact or cands or [None])[0]

    def lines(self, path):
        if path not in self.cache:
            try:
                with open(path, encoding='utf-8', errors='replace') as f:
                    self.cache[path] = f.read().split('\n')
            except OSError:
                self.cache[path] = None
        return self.cache[path]

    def text_files(self):
        return [p for ps in self.index.values() for p in ps if p.endswith('.txt')]


def walk(obj, path=''):
    """결과 JSON 안의 모든 문자열을 (위치, 문자열)로 내놓는다."""
    if isinstance(obj, str):
        yield path, obj
    elif isinstance(obj, dict):
        for k, v in obj.items():
            key = v.get('id') if isinstance(v, dict) and 'id' in v else k
            yield from walk(v, f'{path}.{key}' if path else str(key))
    elif isinstance(obj, list):
        for i, v in enumerate(obj):
            key = v.get('id') if isinstance(v, dict) and isinstance(v.get('id'), str) else i
            yield from walk(v, f'{path}[{key}]')


def check_ref(files, fname, a, b, quote, before, where):
    out = []
    rng = range(a, (b or a) + 1)
    targets = [files.find(fname)] if fname else []
    if fname and not targets[0]:
        return [('파일 없음', where, f'{fname} L{a}', '게임 폴더에서 이 파일을 찾지 못함')]
    if not fname:
        # 파일명 없는 행 번호: 인용이 있으면 맞는 후보를 찾고, 없으면 표시만
        cands = files.text_files()
        parts = [x for x in ELLIPSIS.split(quote or '') if norm(x)]
        hit = [p for p in cands if parts and (ls := files.lines(p)) and any(
            0 < n <= len(ls) and all(norm(x) in norm(' '.join(ls[max(0, n - 2):n + 1])) for x in parts) for n in rng)]
        if not hit and not parts:
            # 인용이 없으면 행 범위가 닿는 파일이 하나뿐일 때만 그 파일로 본다
            reach = [p for p in cands if (ls := files.lines(p)) and (b or a) <= len(ls)]
            if len(reach) == 1:
                hit = reach
        note = (f'인용이 맞는 파일: {", ".join(os.path.basename(h) for h in hit)}' if parts else f'행 범위상 유일 후보: {os.path.basename(hit[0])}') if hit else '어느 파일의 행인지 알 수 없음'
        out.append(('파일명 없음', where, f'L{a}' + (f'~{b}' if b else '') + (f' {quote}' if quote else ''), note))
        if not hit:
            return out
        targets = hit[:1]
    path = targets[0]
    ls = files.lines(path)
    if ls is None:
        return out + [('파일 없음', where, f'{fname} L{a}', '읽을 수 없음')]
    label = f'{os.path.basename(path)} L{a}' + (f'~{b}' if b else '')
    if a < 1 or (b or a) > len(ls):
        return out + [('행 없음', where, label, f'파일은 {len(ls)}행')]
    seg = ' '.join(ls[max(0, a - 2):(b or a) + 1])
    parts = [x for x in ELLIPSIS.split(quote or '') if norm(x)]
    if quote and not all(norm(x) in norm(seg) for x in parts):
        elsewhere = [i + 1 for i, l in enumerate(ls) if all(norm(x) in norm(l) for x in parts)][:3]
        out.append(('인용 불일치', where, f'{label} {quote}',
                    f'다른 위치에 있음: L{", L".join(map(str, elsewhere))}' if elsewhere else f'원문: {ls[a - 1][:80]}'))
    own = ' '.join(ls[a - 1:(b or a)])
    # 주장한 수치(단위 포함) 중 그 행에 없는 것만 — 행이 자리표시자면 수치를 다른 데서 가져온 것
    claim_nums = [n for n in dict.fromkeys(norm(x) for x in NUM_UNIT.findall((quote or '') + ' ' + before)) if n not in norm(own)]
    if PLACEHOLDER.search(own) and claim_nums:
        where_num = [i + 1 for i, l in enumerate(ls) if any(n in norm(l) for n in claim_nums) and not PLACEHOLDER.search(l)][:3]
        out.append(('자리표시자 의심', where, f'{label} ({", ".join(claim_nums)})',
                    f'이 행은 "{own[:60]}" — 수치가 없음' + (f'. 그 수치가 있는 행: L{", L".join(map(str, where_num))}' if where_num else '')))
    return out


def scan_string(files, text, where):
    problems, refs = [], 0
    current, last_end = None, 0
    for m in TOKEN.finditer(text):
        if m.group('file'):
            current, last_end = m.group('file'), m.end()
            continue
        gap = text[last_end:m.start()]
        if current and (len(gap) > FILE_REACH or BREAK.search(gap)):
            current = None
        last_end = m.end()
        refs += 1
        a, b = int(m.group('a')), int(m.group('b')) if m.group('b') else None
        q = m.group('q')[1:-1] if m.group('q') else None
        before = text[max(0, m.start() - 40):m.start()]
        problems += check_ref(files, current, a, b, q, before, where)
    return refs, problems


def scan_doc(path):
    """판정 문서에서 근거·검증 표시가 없는 목록 문장(⑤)."""
    out = []
    with open(path, encoding='utf-8') as f:
        for i, line in enumerate(f, 1):
            t = line.strip()
            if re.match(r'^([-*]|\d+[.)])\s+', t) and len(t) > 25 and not TAG.search(t):
                out.append(('근거 없는 문장', f'{os.path.basename(path)}:{i}', t[:100], '근거나 검증 상태(V번호·APK:·URL·추정·사내 확인)를 달거나 지운다'))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('home')
    ap.add_argument('result')
    ap.add_argument('--doc', nargs='*', default=[])
    ap.add_argument('--out')
    args = ap.parse_args()

    files = Files(args.home)
    with open(args.result, encoding='utf-8') as f:
        data = json.load(f)
    targets = {k: data[k] for k in ('final', 'verification', 'judge') if data.get(k)}
    total, problems = 0, []
    for where, text in walk(targets):
        n, p = scan_string(files, text, where)
        total += n
        problems += p
    for d in args.doc:
        problems += scan_doc(d)

    # 같은 근거가 여러 필드에 반복되면 한 줄로
    seen, uniq = set(), []
    for p in problems:
        k = (p[0], p[2])
        if k not in seen:
            seen.add(k)
            uniq.append(p)
    kinds = ['행 없음', '파일 없음', '인용 불일치', '자리표시자 의심', '파일명 없음', '근거 없는 문장']
    lines = ['# 근거 대조 (결정적, 로컬 파일만)', '',
             f'- 결과: `{args.result}`', f'- 행 번호 근거 {total}개 검사' + (f', 문서 {len(args.doc)}개' if args.doc else ''), '',
             '| 종류 | 건수 |', '| --- | --- |'] + [f'| {k} | {sum(1 for p in uniq if p[0] == k)} |' for k in kinds]
    for k in kinds:
        rows = [p for p in uniq if p[0] == k]
        if rows:
            lines += ['', f'## {k}', '', '| 위치 | 근거 | 내용 |', '| --- | --- | --- |']
            lines += [f'| {w} | {r.replace("|", "/")} | {n.replace("|", "/")} |' for _, w, r, n in rows[:200]]
            if len(rows) > 200:
                lines.append(f'| … | {len(rows) - 200}건 더 | |')
    report = '\n'.join(lines) + '\n'
    if args.out:
        with open(args.out, 'w', encoding='utf-8') as f:
            f.write(report)
    sys.stdout.write(report if not args.out else f'{args.out} 저장 — ' + ', '.join(f'{k} {sum(1 for p in uniq if p[0] == k)}' for k in kinds) + '\n')


if __name__ == '__main__':
    main()

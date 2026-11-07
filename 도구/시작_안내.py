#!/usr/bin/env python3
"""SessionStart 훅 — 세션 시작 시 사용법과 등록된 게임 목록을 사용자에게 보여 준다."""
import json
import os

root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
games_dir = os.path.join(root, '게임')
games = sorted(d for d in os.listdir(games_dir) if not d.startswith('_') and os.path.isdir(os.path.join(games_dir, d))) if os.path.isdir(games_dir) else []

msg = """[게임 아틀라스] 사용법
1) /새게임 <게임이름> <APK 경로> [목적·추가 자료]
   예) /새게임 예시게임 C:\\Users\\<사용자>\\Downloads\\game.xapk 경쟁작 벤치마크, 매출 자료 없음
2) /분석 <게임이름> <이번 회차 지시·확정 결정>
   예) /분석 예시게임 BM 장치 중심으로
등록된 게임: """ + (', '.join(games) if games else '(없음 — /새게임부터)')

# 중재 대기 중인 회차: 회차 폴더의 가장 최근 파일이 중재대기_<k>.json이면 아직 이어갈 차례
waiting = []
for g in games:
    res = os.path.join(games_dir, g, '결과')
    if not os.path.isdir(res):
        continue
    for rd in sorted(os.listdir(res)):
        d = os.path.join(res, rd)
        files = [f for f in os.listdir(d) if f.endswith('.json')] if os.path.isdir(d) else []
        if not files:
            continue
        latest = max(files, key=lambda f: os.path.getmtime(os.path.join(d, f)))
        if latest.startswith('중재대기_'):
            waiting.append(f'{g} {rd} ({latest})')
if waiting:
    msg += '\n⏸ 중재 대기: ' + ', '.join(waiting) + ' — 중재 내용을 보내면 이어서 진행합니다'

print(json.dumps({'systemMessage': msg}, ensure_ascii=False))

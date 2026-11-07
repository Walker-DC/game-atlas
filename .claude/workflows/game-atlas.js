export const meta = {
  name: 'game-atlas',
  description: '게임 아틀라스: 게임 전체 분석·방향 설정(범용) — APK 추출본·사내 자료로 기초 조사 후, 설계자/검토자(Sonnet)가 관점을 돌며 분석하고 판정자(Opus)가 사실 검증·쟁점 판정, 셋이 모두 합의하면 종료 (파일 수정 없음)',
  whenToUse: '/분석 스킬에서 호출. args: {home, game(설정.json 내용), note, base, maxRounds, research(선택: 이어하는 회차에서 추가로 돌릴 조사 갈래 이름 배열), mediateAfter(선택: 같은 설계·같은 반대가 몇 번 되풀이되면 중재 요청, 기본 3, 0이면 끔), resume(중재 대기 결과의 resume 객체), mediation(사용자 중재 내용), verify(선택: 사실 검증, 기본 true), verifyMax(선택: 검증할 근거 수, 기본 25), debateModel(선택: 설계자·검토자 모델, 기본 sonnet), strongModel(선택: 조사·검증·판정자 모델, 기본 opus), org(선택: 분석을 맡긴 회사 이름 — 사내 사실 분류용)}',
  phases: [
    { title: '기초 조사', detail: '첫 회차에만(또는 args.research로 지정한 갈래만) — 게임데이터·BM구조·여론·시장·원작 5갈래 병렬 조사' },
    { title: '설계안', detail: '조사 결과(또는 이전 회차 결과)에서 설계안 작성, 이번 회차 지시 반영' },
    { title: '중재 반영', detail: '중재 대기에서 이어갈 때만 — 사용자 중재를 확정 결정으로 설계안에 반영' },
    { title: '분석', detail: '설정의 관점들을 순환 — 반대측 관점 포함. 같은 설계·같은 반대가 되풀이되면 판정자가 원본 확인 후 판정(사내 사정만 사용자 중재)' },
    { title: '사실 검증', detail: '검토자 전 관점 승인 때마다 — 결론을 받치는 핵심 근거를 분석에 참여하지 않은 에이전트(Opus)가 원본(파일·URL)을 직접 열어 확인하고, 틀린 근거는 설계자가 그 부분만 고침. 설계자 반박은 재검증' },
    { title: '판정', detail: '판정자(Opus)가 검증 결과와 원본으로 최종 확인 — 고칠 것이 있으면 반영 후 검토자가 다시 전 관점 승인해야 함. 설계자·검토자·판정자 셋이 모두 동의하면 종료' },
  ],
}

const A = args || {}
const G = A.game || {}
const HOME = A.home || ''
const NOTE = A.note || ''
const BASE = A.base || ''
const SAFETY_MAX_ROUNDS = A.maxRounds || 24
const NAME = G.name || '대상 게임'
const GOAL = G.goal || '매출'
const BM = G.benchmark || {}
const SUB = G.submission && G.submission.file ? G.submission : null
const SUB_LABEL = SUB ? (SUB.label || '제출안') : ''
const SUB_PREFIX = SUB ? (SUB.prefix || 'D') : ''
const EXTRACT = HOME + '/추출'
const ORIGIN = G.origin || {}
const ONLY = Array.isArray(A.research) ? A.research : []
const RESUME = A.resume && A.resume.state ? A.resume : null
const MEDIATION = A.mediation || ''
const MEDIATE_AFTER = typeof A.mediateAfter === 'number' ? A.mediateAfter : 3
const VERIFY = A.verify !== false
const VERIFY_MAX = A.verifyMax || 25
// 분석(설계자·검토자)은 가벼운 모델, 조사·사실 검증·판정자는 강한 모델 — 모델이 달라야 같은 착각을 함께 할 가능성이 줄어든다
const DEBATE_MODEL = A.debateModel || 'sonnet'
const STRONG_MODEL = A.strongModel || 'opus'
const ORG = A.org || ''

const DEFAULT_LENSES = [
  { key: 'BM공식', desc: `${BM.genre ? `${BM.genre} 장르` : '이 게임이 실제로 속한 장르(겉모습이 아니라 매출 구조 기준)'}의 성공 BM 공식${BM.games ? `(${BM.games} 등이 공통으로 쓰는 매출 장치)` : ''} 중 ${NAME}에 빠졌거나 약한 것, 그리고 설계안이 그 공식을 제대로 구현하는지.${SUB ? ` ${SUB_LABEL} 판정이 맞는지도 본다.` : ''} 가장 중요한 기준은 ${GOAL}` },
  { key: '콘텐츠', desc: '콘텐츠·엔드게임 — 천장 이후 할 것, 신규 콘텐츠 구체 구조, 소모 속도와 갱신 주기, 숙제 피로도' },
  { key: '성장', desc: '성장·초반 경험 — 첫 세션, 초반 이탈 구간, 성장 축 개수와 통폐합, 레벨 곡선, 캐치업, 직업/캐릭터 밸런스' },
  { key: '경제BM', desc: '경제·게임 내 BM 구조 — 재화 흐름(sink/faucet), 거래, 가챠 계열 정리, 상품이 게임 시스템과 맞물리는 구조, 고과금 유저가 오래 쓰게 만드는 장치. 가격 정책·마케팅·법무는 다루지 않음' },
  { key: '경쟁·소셜', desc: 'PvP·길드·월드 구조 — 서버/월드, 경쟁 콘텐츠, 길드 쏠림, 고과금 유저 간 경쟁 구도, 적은 인구에서도 돌아가는지. 장르에 PvP 비중이 낮으면 소셜·협동·랭킹 구조로 본다' },
  { key: '실현성', desc: '개발 실현성 — 기존 자산(테이블·클라이언트·서버 시스템) 재활용 정도, 1차(필수) vs 이후 범위, 구현 난이도, 항목 간 충돌·중복, 개발사 규모로 감당 가능한지' },
  { key: '반대측', desc: '반대 입장 전담 — 설계안의 큰 방향(진단·장르 판정·성공 가능성 판정·컨셉) 자체가 틀렸을 가능성을 공격한다. 디테일 보강 제안은 하지 않는다. 근거(데이터·사례)가 있는 다른 방향이 있으면 제시하고, 같은 근거로 현재 방향이 더 낫다고 판단되면 승인한다. 동의하려고 동의하지 않는다' },
]
const LENSES = Array.isArray(G.lenses) && G.lenses.length ? G.lenses : DEFAULT_LENSES

const materials = (G.materials || []).map(m => `- ${m.path}${m.desc ? ` — ${m.desc}` : ''}`).join('\n')

const SCOPE = `
대상 게임: ${NAME}
배경: ${G.background || '(설정에 없음 — APK·자료로 파악)'}
분석 목적: ${G.purpose || '게임 안에 무엇을 추가/변경/삭제해야 하는가를 개발팀이 바로 기획에 착수할 수 있을 만큼 정하는 것'}
최우선 기준: ${GOAL}. 모든 판단은 이 기준으로 한다. 유저 친화 요소는 이 기준을 오래 유지하는 수단으로서만 채택한다.
${BM.genre ? `비교 기준 장르: ${BM.genre}${BM.games ? ` (사례: ${BM.games})` : ''}${BM.formula ? `\n이 장르의 성공 BM 공식(사용자 제시): ${BM.formula}` : ''}` : '비교 기준 장르: 지정 없음 — 설계자가 매출 구조 기준으로 장르를 판정하고 그 장르의 성공 BM 공식을 정리한다.'}
${G.stance ? `입장 메모: ${G.stance}` : ''}
${SUB ? `${SUB_LABEL}(중요): ${HOME}/${SUB.file} 에 항목(${SUB_PREFIX}1~)이 있다. 각 항목을 ${GOAL} 기준으로 평가(의미 있음 / 조건부 / 의미 없음 / 역효과)하고 근거를 쓴다. 전체가 핵심 부진 원인을 해결하는지, 무엇이 빠졌는지도 판정한다. plan 항목에 관련 ${SUB_PREFIX}번호를 표기한다.` : `제출안: 없음 — subReview는 빈 배열, subOverall은 "해당 없음".`}
범위: ${G.scope || '게임 안의 콘텐츠·시스템 개발만 다룬다.'} 범위 밖: ${G.exclude || '유입·마케팅·UA·스토어·운영 인력·비용·계약·법무 절차·측정 체계'} — 제안하지 않고 plan에도 넣지 않는다(섞여 있으면 걷어낸다).

논의 방식: 반박을 위한 반박 금지. 검증된 게임 디자인 기법·국내외 사례를 근거로 더 나은 방안을 제안하고, 합당하면 인정한다. 같은 효과면 기존 자산 재활용·더 단순한 쪽이 합당하다.
디테일 요구: 항목마다 구체 구조(인원·주기·보상 개요·수치 범위·UI 흐름·기존 시스템 중 무엇을 재활용/삭제하는지)를 쓴다. 막연한 문장 금지.
근거: 파일 경로+수치 또는 URL. 확인 못한 것은 "추정:"으로 시작. APK 추출본에서 읽은 것은 "APK:" 경로로, 매출·지표가 사내 자료가 아니라 외부 추정이면 반드시 "추정:"이라고 쓴다.
- 파일 근거는 '파일명 L행 "원문 일부"' 형식으로 쓴다(행 번호만 쓰지 않는다 — 나중에 기계로 대조한다).
- 추출 문자열 목록은 정렬·중복 제거된 것이라 이웃 행끼리 관계가 없다. 문자열을 특정 시스템·주기·콘텐츠에 귀속하는 것은 그 문자열 안에 이름이 있을 때만 사실이고, 그 밖에는 "추정:". {0}·%s 같은 자리표시자 행에는 수치가 없다 — 수치는 그 값을 담은 다른 행을 인용한다.
- "없음·0건" 주장에는 찾아본 파일과 검색어(동의어·상위 개념 포함)를 함께 쓴다. 추출이 일부뿐이면 "추정: 추출본에서 미발견"으로 쓴다.
- 검색 결과 요약은 근거가 아니다. 원문 URL을 열어 해당 문장을 확인한 것만 URL 근거로 쓰고, 못 열었으면 "추정:". 원문이 단 조건·유보(예: 특정 상황에만 해당)는 빼지 않는다.
- 사내 사실(분석을 맡긴 회사${ORG ? `(${ORG})` : ''}가 관여한 계약·퍼블리싱 주체·출시/종료 일정·내부 매출)은 웹으로 확정하지 않는다 — "사내 확인 필요:"로 쓰고 판정의 전제로만 둔다.
도구: Read/Grep/Glob, 읽기 전용 Bash(python3 파싱), WebSearch, WebFetch. 어떤 파일도 수정·생성하지 않는다. 결과물에 유저 닉네임·계정ID를 쓰지 않는다.

자료:
- APK 추출본: ${EXTRACT}/ (먼저 ${EXTRACT}/요약.md 를 읽는다 — 엔진, 데이터 파일 위치, 한글 문자열, 암호화 여부)
- 게임 자료 폴더: ${HOME}/자료/
${materials}
결과는 한국어.
${BASE ? `\n이전 회차 결과(최종 설계안·판정·점검표·결정 항목·기초 조사 전체, JSON): ${BASE}` : ''}
${NOTE ? `\n이번 회차 사용자 지시·확정 결정(최우선 — 확정 결정은 바꾸지 말고 그대로 반영, 다시 사용자 결정 항목으로 올리지 않는다):\n${NOTE}` : ''}`

const FACT = { type: 'object', properties: { claim: { type: 'string' }, evidence: { type: 'string' } }, required: ['claim', 'evidence'] }

// ── 1. 기초 조사 (첫 회차만) ──
const RESEARCH_SCHEMA = { type: 'object', properties: {
  summary: { type: 'string', description: '이 갈래의 핵심 발견 요약(우선순위 순)' },
  facts: { type: 'array', items: FACT, description: '구체 사실 — 수치·테이블명·파일 경로·URL' },
  gaps: { type: 'array', items: { type: 'string' }, description: '자료가 없거나 읽지 못해 확인 못한 것' },
}, required: ['summary', 'facts', 'gaps'] }

const BRANCHES = [
  { key: '게임데이터', prompt: `APK 추출본을 조사해 ${NAME}의 시스템 지도를 만든다: 콘텐츠 목록, 성장 축(레벨·장비·강화·카드·펫 등) 전부와 개수, 레벨/스테이지 구조, 직업·캐릭터, 파티 구조, 월드/서버 구조, PvP·길드 콘텐츠, 재화 종류. 데이터 테이블(json/csv/TextAsset)과 한글 UI 문자열, IL2CPP/DEX 클래스명을 근거로 쓴다. 읽지 못한 부분(암호화·외부 다운로드)은 gaps에.` },
  { key: 'BM구조', prompt: `APK 추출본과 자료에서 ${NAME}의 BM 구조를 정리한다: 상품 목록·가격대(상품 ID·스토어 SKU 문자열·상점 테이블), 가챠 계열과 확률·천장, 패스·월정액·VIP, 유료/무료 재화 구분, 거래소 여부, 강화 실패·파괴·보호, 상품이 어떤 성장 축과 연결되는지. 결제·분석 SDK도 적는다.` },
  { key: '여론·지표', prompt: `게임 자료 폴더와 사내 자료에 있는 지표(매출·DAU·잔존·이탈 구간)와 유저 여론(커뮤니티 글·리뷰)을 정리한다. 사내 자료가 없으면 공개 정보(스토어 평점·리뷰 경향, 매출 순위 추이, 커뮤니티)를 WebSearch로 찾고 모두 "추정:"으로 표시한다. 유저 닉네임은 쓰지 않는다.` },
  { key: '원작', prompt: `${NAME}이 다른 나라 게임을 들여온(현지화한) 것인지 판별하고, 그렇다면 원작 국가의 자료를 그 나라 언어로 찾는다.${ORIGIN.title || ORIGIN.country ? ` 설정상 원작 정보: ${[ORIGIN.title, ORIGIN.country, ORIGIN.developer, ORIGIN.note].filter(Boolean).join(' / ')}.` : ' 설정에 원작 정보가 없으면 APK의 외국어 문자열·로고·판호/ISBN·저작권자·CDN 경로·패키지명으로 원작명과 국가를 먼저 특정한다.'}
- 검색은 원작 국가 언어로 한다(원작명 원문 표기 그대로). 국가별 우선 출처 — 중국: TapTap, 七麦数据·点点数据(순위), 游戏葡萄·竞核·GameLook·36氪(업계 기사), B站·微博·NGA(여론), 판호 공시 / 일본: 4Gamer·ファミ通·Game*Spark, AppMedia·GameWith, 5ch·X / 대만·홍콩: 巴哈姆特 / 미국·서구: Reddit, PocketGamer, AppMagic·Sensor Tower 공개 글 / 그 밖: 그 나라 1위 게임 커뮤니티·스토어.
- 찾을 것: 원작 출시일·개발사·퍼블리셔, 원작 성과(매출·순위 추이·다운로드, 서비스 종료 여부와 시점), 원작 여론에서 반복되는 불만·호평, 원작의 업데이트·시즌·BM 변화 이력, 원작판과 국내판의 차이(콘텐츠·가격·확률·VIP 등).
- 원작이 실패했거나 종료됐으면 그 이유를 반드시 찾는다. 국내판 성공 가능성 판단의 가장 강한 근거다.
- 외국어 원문은 핵심 구절을 짧게 인용하고 한국어 번역을 붙인다. URL 필수, 확인 못한 수치는 "추정:".
- 국내 개발 게임으로 판별되면 그 근거를 쓰고 summary를 짧게 끝낸다.` },
  { key: '시장벤치마크', prompt: `${NAME}과 같은 장르·${BM.genre ? `특히 ${BM.genre}` : '매출 구조가 비슷한 게임'}의 성공작들이 공통으로 쓰는 매출 장치·콘텐츠 갱신 주기·시즌제 사례를 조사한다(WebSearch/WebFetch, URL 필수). ${NAME}과 비교해 차이가 큰 지점을 짚는다.` },
]

let research = []
const RUN_BRANCHES = RESUME ? [] : !BASE ? BRANCHES : BRANCHES.filter(b => ONLY.includes(b.key))
if (RUN_BRANCHES.length) {
  phase('기초 조사')
  research = await parallel(RUN_BRANCHES.map(b => () =>
    agent(`당신은 게임 분석가다. 갈래: ${b.key}.\n${b.prompt}\n${SCOPE}`, { label: `조사: ${b.key}`, phase: '기초 조사', schema: RESEARCH_SCHEMA, model: STRONG_MODEL })
      .then(r => r ? { branch: b.key, ...r } : null)
  ))
  research = research.filter(Boolean)
  log(`기초 조사 ${research.length}/${RUN_BRANCHES.length}갈래 완료`)
}
const researchText = research.map(r => `## ${r.branch}\n${r.summary}\n` + r.facts.map(f => `- ${f.claim} (${f.evidence})`).join('\n') + (r.gaps.length ? `\n확인 못함: ${r.gaps.join(' / ')}` : '')).join('\n\n')

// ── 2. 설계안 ──
const PLAN_ITEM = { type: 'object', properties: {
  id: { type: 'string', description: 'G1, G2 ...' },
  area: { type: 'string', enum: ['콘텐츠', '성장', '경제', '게임내BM', 'PvP·길드', '월드구조', '편의·UX', '정리·삭제'] },
  title: { type: 'string' },
  detail: { type: 'string', description: '구체 구조·수치·흐름. 기존 시스템 재활용/삭제 대상 명시' },
  why: { type: 'string', description: '어떤 문제(이탈·매출 부진 원인)를 어떻게 해결하는지' },
  kpi: { type: 'string', description: '게임 내 지표 기준 성공 판단' },
  priority: { type: 'string', enum: ['필수', '권장', '선택'] },
  scope: { type: 'string', enum: ['1차(필수)', '2차', '3차 이후'] },
  devNote: { type: 'string', description: '기존 자산 재활용 여부, 신규 개발 규모(소/중/대), 의존 항목' },
  evidence: { type: 'string' },
}, required: ['id', 'area', 'title', 'detail', 'why', 'kpi', 'priority', 'scope', 'devNote', 'evidence'] }

const DECISION = { type: 'object', properties: { title: { type: 'string' }, options: { type: 'string' }, recommendation: { type: 'string' } }, required: ['title', 'options', 'recommendation'] }

const BM_ITEM = { type: 'object', properties: {
  element: { type: 'string', description: '기준 장르 성공 BM 공식 요소' },
  successCases: { type: 'string', description: '어떤 게임이 어떻게 쓰는지 + 출처' },
  current: { type: 'string', enum: ['있음', '약함', '없음'] },
  currentEvidence: { type: 'string', description: '현재 게임에서의 상태 근거(파일/수치)' },
  plan: { type: 'string', description: '대응 plan id 또는 "의도적 미채택: 이유"' },
}, required: ['element', 'successCases', 'current', 'currentEvidence', 'plan'] }

const SUB_ITEM = { type: 'object', properties: {
  id: { type: 'string' },
  item: { type: 'string', description: '제출안 항목 요약' },
  verdict: { type: 'string', enum: ['의미 있음', '조건부', '의미 없음', '역효과'] },
  reason: { type: 'string', description: `${GOAL} 기준 이유 + 근거(파일/수치/여론)` },
  fix: { type: 'string', description: '유지/수정 방향/폐기/대체안. 관련 plan id' },
}, required: ['id', 'item', 'verdict', 'reason', 'fix'] }

const CORE = {
  subOverall: { type: 'string', description: '제출안 전체 총평(없으면 "해당 없음")' },
  subReview: { type: 'array', items: SUB_ITEM, description: '제출안 항목 전부 하나씩(없으면 빈 배열)' },
  genreVerdict: { type: 'string', description: '겉 장르와 실제 매출 구조 장르 판정 + 근거. 혼합형이면 어느 부분이 어긋나는지' },
  bmChecklist: { type: 'array', items: BM_ITEM, description: '기준 장르 성공 BM 공식 점검표 — 최대한 빠짐없이' },
  diagnosis: { type: 'string', description: '게임 내부 관점의 부진 원인(우선순위, 수치)' },
  outlook: { type: 'object', description: '성공 가능성 판정 — 현재 상태 그대로일 때와 plan 적용 시를 나눠, 얼버무리지 않고 결론부터', properties: {
    verdict: { type: 'string', enum: ['성공', '조건부 성공', '실패'], description: '현재 상태 그대로 갔을 때의 판정' },
    confidence: { type: 'string', enum: ['높음', '중간', '낮음'], description: '판정 확신도(실측 매출 자료가 없으면 높음 금지)' },
    reasons: { type: 'string', description: '판정 이유(우선순위 순, 근거 경로·URL 포함)' },
    howToSucceed: { type: 'string', description: '성공하려면 무엇이 바뀌어야 하는지(조건·순서·plan 항목 연결)와 그때의 기대 위치' },
  }, required: ['verdict', 'confidence', 'reasons', 'howToSucceed'] },
  concept: { type: 'string', description: '방향 컨셉 한 줄 + 설명' },
  coreLoop: { type: 'string', description: '일일/주간/시즌 플레이 루프와 지출 지점이 어디에 걸리는지' },
  plan: { type: 'array', items: PLAN_ITEM },
}
const CORE_KEYS = Object.keys(CORE)

const DESIGN_SCHEMA = { type: 'object', properties: {
  ...CORE,
  removed: { type: 'array', items: FACT, description: '범위 밖이라 걷어낸 것(제목+이유)' },
  userDecisions: { type: 'array', items: DECISION },
}, required: [...CORE_KEYS, 'removed', 'userDecisions'] }

let design = null
if (!RESUME) {
phase('설계안')
design = await agent(`당신은 ${NAME} 게임 디자인 총괄(설계자)이다. ${BASE ? `이전 회차 결과(${BASE})를 출발점으로 읽고, 이번 회차 지시를 반영해 고친다.` : `아래 기초 조사 결과를 출발점으로,`} 필요하면 APK 추출본과 자료를 직접 확인하면서 설계안을 쓴다.
- ${SUB ? `가장 먼저 ${SUB_LABEL}을 전부 하나씩 평가(subReview)하고 총평(subOverall)을 쓴다.` : '제출안은 없다.'}
- genreVerdict(겉 장르와 실제 매출 구조가 맞는지 솔직하게)와 bmChecklist(성공 BM 공식 요소별 현재 있음/약함/없음, 대응)를 작성하고, 없음/약함 요소는 plan 항목으로 채우거나 의도적 미채택 이유를 쓴다.
- outlook에 성공 가능성(성공/조건부 성공/실패)을 결론부터 쓰고, 이유와 '어떻게 하면 성공하는지'를 함께 쓴다. 판정을 피하지 않는다.
- 진단을 게임 내부 원인 중심으로 정리하고, coreLoop(일/주/시즌 루프와 지출 지점)를 먼저 확정한 뒤 plan 항목이 그 루프의 어디를 고치는지 연결한다.
- 과잉인 것(성장 축·가챠 계열·상품 수 등)의 정리/삭제도 plan 항목(area='정리·삭제')으로.
- 1차(필수) 범위는 꼭 필요한 것만 — 항목 대부분을 1차로 몰지 않는다.
- 각 항목은 개발팀이 기획서를 바로 쓸 수 있을 만큼 구체적으로.
${researchText ? `\n기초 조사 결과:\n${researchText}\n` : ''}${SCOPE}`, { label: '설계자: 설계안', phase: '설계안', schema: DESIGN_SCHEMA, model: DEBATE_MODEL })

if (!design) return { error: '설계자 실패', stopReason: 'agent_error', research }
}

// ── 3. 분석 ──
const PROPOSAL = { type: 'object', properties: {
  id: { type: 'string' }, kind: { type: 'string', enum: ['better_approach', 'simplify', 'fix_flaw', 'missing', 'more_detail', 'out_of_scope', 'direction_change'] },
  target: { type: 'string' }, idea: { type: 'string' }, benefit: { type: 'string' }, cost: { type: 'string' }, evidence: { type: 'string' },
  repeatOf: { type: 'string', description: '이전에 설계자가 비채택·변형한 제안과 같은 취지를 다시 내는 것이면 그 제안 id, 새 제안이면 빈 문자열' },
  sameObjection: { type: 'boolean', description: 'repeatOf가 있고, 이전 주장과 같은 반대를 새 근거 없이 다시 내는 것이면 true. 새 제안이거나 새 근거·새 대안이 있으면 false' },
}, required: ['id', 'kind', 'target', 'idea', 'benefit', 'cost', 'evidence', 'repeatOf', 'sameObjection'] }

const REVIEW_SCHEMA = { type: 'object', properties: {
  priorVerdicts: { type: 'array', items: { type: 'object', properties: { proposalId: { type: 'string' }, verdict: { type: 'string', enum: ['agree', 'disagree'] }, reason: { type: 'string' },
    sameObjection: { type: 'boolean', description: 'disagree이고, 이 쟁점에서 이전에 낸 반대와 같은 주장을 새 근거·새 대안 없이 되풀이하는 것이면 true. agree이거나 새 근거·새 대안이 있으면 false' } }, required: ['proposalId', 'verdict', 'reason', 'sameObjection'] } },
  newResearch: { type: 'array', items: FACT },
  proposals: { type: 'array', items: PROPOSAL },
  planApproved: { type: 'boolean' }, approvalReason: { type: 'string' },
}, required: ['priorVerdicts', 'newResearch', 'proposals', 'planApproved', 'approvalReason'] }

const RESPONSE_SCHEMA = { type: 'object', properties: {
  evaluations: { type: 'array', items: { type: 'object', properties: { proposalId: { type: 'string' }, judgement: { type: 'string', enum: ['adopt', 'adapt', 'decline', 'escalate'] }, reason: { type: 'string' }, counterProposal: { type: 'string' },
    sameDesign: { type: 'boolean', description: '이 쟁점에 대해 이전 판단·역제안을 그대로 유지하고 설계안 내용도 바꾸지 않았으면 true. 처음 판단하는 제안이거나, 이번에 설계안을 실제로 고쳤거나, 새 역제안·새 근거를 냈으면 false' } }, required: ['proposalId', 'judgement', 'reason', 'counterProposal', 'sameDesign'] } },
  selfCorrections: { type: 'array', items: { type: 'string' } },
  ...CORE,
  newUserDecisions: { type: 'array', items: DECISION },
  designerApproves: { type: 'boolean' },
}, required: ['evaluations', 'selfCorrections', ...CORE_KEYS, 'newUserDecisions', 'designerApproves'] }

const APPLY_SCHEMA = { type: 'object', properties: {
  applied: { type: 'array', items: { type: 'object', properties: {
    disputeId: { type: 'string' },
    decision: { type: 'string', description: '이 쟁점·항목에 대해 정해진 것(한두 문장)' },
    change: { type: 'string', description: '설계안에서 실제로 바꾼 곳(plan id·필드)' },
  }, required: ['disputeId', 'decision', 'change'] } },
  objections: { type: 'array', items: { type: 'object', properties: { disputeId: { type: 'string' }, objection: { type: 'string', description: '판정이 틀렸다고 보는 이유 + 근거(파일명 L행 "인용" 또는 URL)' } }, required: ['disputeId', 'objection'] }, description: '판정자 판정에만 — 원본 근거로 판정이 틀렸다고 확신할 때만. 없으면 빈 배열' },
  ...CORE,
  newUserDecisions: { type: 'array', items: DECISION },
}, required: ['applied', 'objections', ...CORE_KEYS, 'newUserDecisions'] }

const planText = s => (SUB ? `${SUB_LABEL} 총평: ${s.subOverall}\n\n${SUB_LABEL} 항목별 평가:\n` + s.subReview.map(x => `- ${x.id} ${x.item} → ${x.verdict}: ${x.reason} | 조치: ${x.fix}`).join('\n') + '\n\n' : '')
  + `장르 판정: ${s.genreVerdict}\n\n성공 BM 공식 점검표:\n` + s.bmChecklist.map(x => `- ${x.element} | 현재 ${x.current} (${x.currentEvidence}) | 사례: ${x.successCases} | 대응: ${x.plan}`).join('\n')
  + `\n\n진단:\n${s.diagnosis}\n\n성공 가능성: ${s.outlook.verdict} (확신도 ${s.outlook.confidence})\n  - 이유: ${s.outlook.reasons}\n  - 성공 조건: ${s.outlook.howToSucceed}\n\n컨셉: ${s.concept}\n\n핵심 루프:\n${s.coreLoop}\n\n` + s.plan.map(p =>
  `[${p.id}] (${p.area}/${p.priority}/${p.scope}) ${p.title}\n  - 내용: ${p.detail}\n  - 이유: ${p.why}\n  - KPI: ${p.kpi}\n  - 개발: ${p.devNote}\n  - 근거: ${p.evidence}`).join('\n')

// 쟁점(thread): 같은 취지의 제안이 라운드를 넘어 오가는 흐름. 양쪽 모두 이전과 다른 근거·대안을 내도록 요구하고,
// 그래도 설계자가 같은 설계를 유지하고 검토자가 같은 반대를 새 근거 없이 되풀이한 왕복이 연속 MEDIATE_AFTER번 쌓일 때만 사용자 중재를 요청한다.
let state = {}
const src = RESUME ? RESUME.state : design
CORE_KEYS.forEach(k => { state[k] = src[k] })
const userDecisions = RESUME ? [...(RESUME.userDecisions || [])] : [...design.userDecisions]
let open = RESUME ? (RESUME.open || []) : []
const lensApproved = new Set(RESUME ? (RESUME.lensApproved || []) : [])
const threads = RESUME ? (RESUME.threads || {}) : {}
const settled = RESUME ? [...(RESUME.settled || [])] : []
const START = RESUME ? (RESUME.nextRound || 1) : 1
const rounds = []
let stopReason = ''
let mediationResult = null
let hot = []

const settledText = () => settled.length
  ? `\n사용자 중재로 확정된 결정(바꾸지 않고, 같은 취지로 다시 제기하지 않는다):\n` + settled.map(s => `- [${s.id}] ${s.idea} → ${s.decision}`).join('\n') + '\n'
  : ''
const threadOf = id => Object.values(threads).find(t => t.ids.includes(id))
// 같은 설계 vs 같은 반대가 연속으로 되풀이된 횟수. 어느 한쪽이라도 설계를 바꾸거나 새 근거·대안을 내면 0부터 다시 센다.
const backAndForth = t => t.exchanges.reduce((n, e) => (['adapt', 'decline'].includes(e.judgement) && e.same ? n + 1 : 0), 0)
const lastObjection = t => { const e = t && t.exchanges[t.exchanges.length - 1]; return e ? e.reviewer : '' }

// 판정자 상태: 판정자 판정에 설계자가 근거를 들어 낸 이의(다음 판정 때 판정자가 본다)와 그 왕복 횟수
let designerObjections = RESUME ? [...(RESUME.designerObjections || [])] : []
let objectionRounds = RESUME ? (RESUME.objectionRounds || 0) : 0
const judgeLog = RESUME ? [...(RESUME.judgeLog || [])] : []
let verification = null

// 확정 결정(사용자 중재·판정자 판정)을 설계자가 설계안에 반영한다.
// items: [{ id, target, idea, decision?, history? }]
async function applyDecisions(source, items, overallText, label, ph) {
  const byUser = source === '사용자'
  const res = await agent(`당신은 ${NAME} 게임 디자인 총괄(설계자)이다. ${byUser
    ? '분석이 아래 쟁점에서 같은 주장만 오가 멈췄고, 사용자가 중재했다. 사용자 중재는 확정 결정이다 — 그대로 설계안에 반영하고 다시 사용자 결정 항목으로 올리지 않는다. 중재가 언급하지 않은 쟁점은 양쪽 근거와 중재의 취지를 함께 보고 정리한다. objections는 빈 배열.'
    : '판정자(다른 모델, 원본을 직접 확인함)가 아래 항목을 판정했다. 판정은 확정 결정이다 — 그대로 설계안에 반영한다. 원본 근거로 판정이 틀렸다고 확신할 때만, 반영은 하되 objections에 근거(파일명 L행 "인용" 또는 URL)를 쓴다 — 판정자가 다음 판정 때 본다. 근거 없는 이의는 쓰지 않는다.'} 필요하면 자료를 직접 확인한다.

현재 설계안:
${planText(state)}

${byUser ? '멈춘 쟁점' : '판정 항목'}:
${items.map(d => `- [${d.id}] (대상 ${d.target}) ${d.idea}${d.decision ? `\n  판정: ${d.decision}` : ''}${d.history ? `\n${d.history}` : ''}`).join('\n')}
${overallText ? `\n${byUser ? '사용자 중재' : '판정자 의견'}:\n${overallText}\n` : ''}
applied에 항목마다 무엇으로 정해졌고 설계안 어디를 바꿨는지 쓴다. plan은 반영 끝난 전체(id 유지).
${settledText()}${SCOPE}`, { label, phase: ph, schema: APPLY_SCHEMA, model: DEBATE_MODEL })
  if (!res) return null
  CORE_KEYS.forEach(k => { state[k] = res[k] })
  userDecisions.push(...res.newUserDecisions)
  items.forEach(d => {
    const a = res.applied.find(x => x.disputeId === d.id)
    settled.push({ id: d.id, idea: d.idea, by: source, decision: d.decision || (a ? a.decision : overallText), change: a ? a.change : '' })
    if (threads[d.id]) threads[d.id].status = byUser ? 'mediated' : 'judged'
  })
  if (!byUser) designerObjections = res.objections.map(o => ({ ...o, idea: (items.find(d => d.id === o.disputeId) || {}).idea || '' }))
  return res
}
const historyText = d => d.exchanges.map(e => `  · ${e.round}차(${e.lens}) ${e.lens === '판정자' ? '판정자' : '검토자'}: ${e.reviewer}\n    설계자(${e.judgement}): ${e.reason}${e.counter ? ` / 역제안: ${e.counter}` : ''}`).join('\n')

// ── 사실 검증 ──
// 같은 모델끼리 분석하면 같은 잘못된 사실을 함께 믿을 수 있다. 분석에 참여하지 않은 에이전트가 주장과 근거 위치만 받아 원본을 직접 열어 확인한다.
const BAD = ['다름', '못 찾음', '근거 없음', '과장', '일부만']
const CLAIMS_SCHEMA = { type: 'object', properties: { claims: { type: 'array', items: { type: 'object', properties: {
  id: { type: 'string', description: 'V1, V2 ...' },
  claim: { type: 'string', description: '검증할 사실 한 문장(수치·이름 포함, 해석·주장 말고 사실만)' },
  evidence: { type: 'string', description: '설계안에 적힌 근거 위치 그대로(파일 경로·URL·추정 문구)' },
  kind: { type: 'string', enum: ['APK', '자료', 'URL', '추정', '부재', '사내', '근거 없음'] },
  usedIn: { type: 'array', items: { type: 'string' }, description: "쓰인 곳 — 'outlook' / 'genreVerdict' / 'diagnosis' / 'bmChecklist' / 'coreLoop' / 'plan:G3' 형식만" },
  core: { type: 'boolean', description: '틀리면 장르 판정·성공 가능성 판정·진단·1차(필수) 항목이 바뀌는 사실이면 true' },
}, required: ['id', 'claim', 'evidence', 'kind', 'usedIn', 'core'] } } }, required: ['claims'] }
const CHECK_SCHEMA = { type: 'object', properties: { results: { type: 'array', items: { type: 'object', properties: {
  id: { type: 'string' },
  status: { type: 'string', enum: ['확인됨', '과장', '일부만', '다름', '못 찾음', '확인 불가'] },
  actual: { type: 'string', description: '원본에서 실제로 본 내용·수치와 원본이 단 조건. 확인됨이면 일치한 부분' },
  quote: { type: 'string', description: '원본 문장 그대로(번역·요약 금지, 앞뒤 한 문장 포함). 열 수 없었으면 빈 문자열' },
  checked: { type: 'string', description: '실제로 열어 본 파일 경로·URL·검색어' },
}, required: ['id', 'status', 'actual', 'quote', 'checked'] } } }, required: ['results'] }
const HOW = {
  APK: `파일을 직접 열거나 grep으로 찾아 그 행에 인용 문구가 있는지, 주장이 그 문구에 없는 귀속(어느 시스템·주기의 것인지)·수치를 더했는지 본다. 자리표시자({0}·%s) 행에 수치를 붙였으면 다름. 추출본 위치: ${EXTRACT}/`,
  자료: `게임 자료 폴더(${HOME}/자료/)와 설정의 자료 파일을 직접 열어 대조한다.`,
  URL: 'WebFetch로 URL을 열어 해당 문장과 앞뒤 문장을 원문 그대로 달라고 해서 본다(요약 말고 원문). 열리지 않으면 같은 출처를 WebSearch로 찾아 연다. 검색 결과 요약만으로는 확인됨을 주지 않는다.',
  추정: '이 근거를 쓰지 말고, 원작 국가 언어 포함 독립 검색(WebSearch → WebFetch로 원문 열기)으로 같은 사실을 다시 찾는다. 비슷한 값이 나오면 확인됨(여전히 추정임), 크게 다르면 다름, 어떤 출처도 없으면 못 찾음.',
  부재: `"없다·0건" 주장이다. 같은 뜻의 다른 낱말·상위 개념·원어(중국어·영어 등) 문자열까지 넓혀 ${EXTRACT}/ 와 자료를 찾는다. 관련 문자열이 있으면 다름(actual에 그 행). 넓혀도 없으면 확인됨이지만 actual에 "추출본 기준"이라고 쓰고, 추출이 일부뿐(암호화·외부 다운로드)이면 확인 불가.`,
}
const verifyCache = {}
const vkey = c => `${(c.evidence || '').slice(0, 160)}|${(c.claim || '').slice(0, 40)}`
const kindOf = ev => /https?:\/\//.test(ev) ? 'URL' : /APK:|추출\//.test(ev) ? 'APK' : '자료'

// 같은 근거는 회차 안에서 다시 검증하지 않는다(합의 시도가 여러 번이어도 새 근거만 검증).
async function checkClaims(list, tag) {
  const todo = list.filter(c => !verifyCache[vkey(c)])
  const groups = []
  ;['APK', '자료', 'URL', '추정', '부재'].forEach(k => {
    const l = todo.filter(c => c.kind === k)
    for (let i = 0; i < l.length; i += 8) groups.push({ kind: k, list: l.slice(i, i + 8) })
  })
  const out = await parallel(groups.map(g => () =>
    agent(`당신은 사실 검증 담당이다. 이 주장들이 어디서 나왔는지, 누가 주장했는지는 모른다. 근거 위치를 직접 열어 확인하는 것만 한다.
- 기억·상식으로 판정하지 않는다. 실제로 열어 본 내용만 인정한다. 맞다는 증거보다 틀렸다는 증거를 찾는 태도로 본다.
- 확인 방법: ${HOW[g.kind]}
- 판정: 확인됨(원본에 그대로 있음) / 과장(원본은 조건·유보를 달았는데 주장은 단정·일반화) / 일부만(묶인 사실 중 일부만 원본에 있음 — actual에 어느 부분이 없는지) / 다름(원본은 있지만 내용·수치가 다름 — actual에 원본 값) / 못 찾음(경로·URL이 없거나 거기에 해당 내용이 없음) / 확인 불가(유료·접속 차단·암호화로 열 수 없음).
- 수치는 반올림·단위 차이 정도면 확인됨, 자릿수·순위·조건이 다르면 다름.
- quote에는 원본 문장을 원문 언어 그대로 적는다(번역·요약 금지).
- 읽기 전용이다. 어떤 파일도 수정·생성하지 않는다. 유저 닉네임은 쓰지 않는다.

확인할 주장:
${g.list.map(c => `- ${c.id}: ${c.claim}\n  근거 위치: ${c.evidence}`).join('\n')}`, { label: `검증${tag}: ${g.kind} ${g.list[0].id}~`, phase: '사실 검증', schema: CHECK_SCHEMA, model: STRONG_MODEL })
  ))
  out.forEach((x, gi) => x && x.results.forEach(r => { const c = groups[gi].list.find(c => c.id === r.id); if (c) verifyCache[vkey(c)] = r }))
  return list.map(c => ({ ...c, ...(verifyCache[vkey(c)] || { status: '확인 불가', actual: '검증 에이전트 실패', quote: '', checked: '' }), id: c.id }))
}

async function verifyDesign(tag) {
  phase('사실 검증')
  const picked = await agent(`당신은 사실 검증 준비 담당이다. 아래 최종 설계안에서 결론을 받치는 사실 주장을 최대 ${VERIFY_MAX}개 뽑는다. 파일을 열어 볼 필요는 없다 — 설계안 글에서 뽑기만 한다.
- 우선순위: 성공 가능성 판정 이유 → 장르 판정 → 진단 → bmChecklist의 '없음/약함' 근거 → 1차(필수) plan 항목의 근거 → 나머지.
- 의견·제안이 아니라 확인 가능한 사실(수치, 테이블·문자열 존재, 외부 게임의 성과·BM, 원작 성과·종료 여부, 순위·매출 추정)만 뽑는다.
- 한 근거에 여러 사실이 섞여 있으면 나눈다. 같은 사실이 여러 곳에 쓰였으면 하나로 합치고 usedIn에 모두 적는다.
- kind: "APK:" 경로면 APK, 게임 자료 폴더·사내 자료 파일이면 자료, URL이면 URL, "추정:"이면 추정(URL이 같이 있으면 URL), "없음·0건·미발견" 주장이면 부재, 분석을 맡긴 회사${ORG ? `(${ORG})` : ''}가 관여한 계약·퍼블리싱·출시/종료 일정·내부 매출이면 사내, 근거가 비어 있거나 위치 없이 "업계 일반"·"검색 요약" 식이면 근거 없음.

최종 설계안:
${planText(state)}`, { label: `검증${tag}: 근거 추리기`, phase: '사실 검증', schema: CLAIMS_SCHEMA, model: STRONG_MODEL })

  const mustPlan = new Set(state.plan.filter(p => p.scope === '1차(필수)').map(p => p.id))
  const claims = (picked ? picked.claims.slice(0, VERIFY_MAX) : []).map(c => {
    const kind = ORG && `${c.claim} ${c.evidence}`.includes(ORG) ? '사내' : c.kind
    // 핵심 여부는 모델 판단에 더해 코드가 강제한다 — 판정·진단·1차 항목에 쓰인 사실은 무조건 핵심
    const core = c.core || (c.usedIn || []).some(u => ['outlook', 'genreVerdict', 'diagnosis'].includes(u) || (u.startsWith('plan:') && mustPlan.has(u.slice(5))))
    return { ...c, kind, core }
  })
  if (!picked) log('검증: 근거 추리기 실패 — 이번 검증은 건너뜀')
  const checked = await checkClaims(claims.filter(c => !['사내', '근거 없음'].includes(c.kind)), tag)
  const items = claims.map(c => c.kind === '근거 없음' ? { ...c, status: '근거 없음', actual: '', quote: '', checked: '' }
    : c.kind === '사내' ? { ...c, status: '사내 확인 필요', actual: '', quote: '', checked: '' }
    : checked.find(x => x.id === c.id))
  const tally = st => items.filter(i => i.status === st).length
  log(`사실 검증${tag} ${items.length}건: 확인됨 ${tally('확인됨')} / 과장 ${tally('과장')} / 일부만 ${tally('일부만')} / 다름 ${tally('다름')} / 못 찾음 ${tally('못 찾음')} / 근거 없음 ${tally('근거 없음')} / 사내 ${tally('사내 확인 필요')} / 확인 불가 ${tally('확인 불가')}`)
  items.filter(i => i.core && i.status === '사내 확인 필요').forEach(i =>
    userDecisions.push({ title: `사내 확인 필요: ${i.claim}`.slice(0, 120), options: '사실 / 사실 아님 / 모름', recommendation: `현재 근거: ${i.evidence} — 판정의 전제로만 쓰였는지 확인` }))

  const bad = items.filter(i => i.core && BAD.includes(i.status))
  const marks = items.filter(i => !i.core && BAD.includes(i.status))
  let corrections = [], reverify = []
  const outlookBefore = state.outlook
  if (bad.length || marks.length) {
    const FIX_SCHEMA = { type: 'object', properties: {
      corrections: { type: 'array', items: { type: 'object', properties: {
        id: { type: 'string', description: '검증 항목 id(V번호)' },
        action: { type: 'string', enum: ['수정', '추정으로 낮춤', '표시만', '다른 위치에 있음', '바꿀 필요 없음'] },
        change: { type: 'string', description: '설계안에서 실제로 바꾼 곳과 내용, 또는 바꾸지 않은 이유' },
        newEvidence: { type: 'string', description: "'다른 위치에 있음'·'바꿀 필요 없음'이면 새 근거(파일명 L행 \"인용\" 또는 URL) — 다른 에이전트가 다시 확인한다. 그 밖에는 빈 문자열" },
      }, required: ['id', 'action', 'change', 'newEvidence'] } },
      ...CORE,
      newUserDecisions: { type: 'array', items: DECISION },
    }, required: ['corrections', ...CORE_KEYS, 'newUserDecisions'] }
    const fix = await agent(`당신은 ${NAME} 게임 디자인 총괄(설계자)이다. 설계안의 근거를 별도 에이전트가 원본과 대조했더니 아래 항목이 원본과 다르거나, 과장됐거나, 찾을 수 없었다.
- 핵심 근거: 이 근거에 기대는 부분만 고친다 — 원본의 실제 값·조건으로 바꾸거나(수정), 근거를 "추정:"으로 낮추거나, 그 근거 없이도 성립하는지 다시 판단한다. 필요하면 원본을 직접 확인한다.
- 핵심 아닌 근거: 내용은 고치지 말고 해당 문장 끝에 [검증: 상태] 표시만 붙인다(표시만).
- 다른 부분은 건드리지 않는다. 새 plan 항목을 추가하지 않는다(id 유지).
- 장르 판정·성공 가능성 판정이 이 근거에 기대고 있었다면 확신도를 낮춘다. 판정 자체를 바꿔야 한다고 보면 바꾸되 corrections에 분명히 쓴다.
- 검증 결과를 무시하고 기존 내용을 지키려 하지 않는다. 검증이 잘못 본 것이 확실하면 '다른 위치에 있음' 또는 '바꿀 필요 없음'과 newEvidence(파일명 L행 "인용" 또는 URL)를 쓴다 — 다른 에이전트가 다시 확인한다.

핵심 근거:
${bad.map(i => `- ${i.id} [${(i.usedIn || []).join(', ')}] ${i.claim}\n  설계안 근거: ${i.evidence}\n  검증: ${i.status}${i.actual ? ` — 원본: ${i.actual}` : ''}${i.quote ? `\n  원문: ${i.quote}` : ''}${i.checked ? ` (확인한 곳: ${i.checked})` : ''}`).join('\n') || '(없음)'}

핵심 아닌 근거(표시만):
${marks.map(i => `- ${i.id} [${(i.usedIn || []).join(', ')}] ${i.claim} → ${i.status}`).join('\n') || '(없음)'}

현재 설계안:
${planText(state)}
${settledText()}${SCOPE}`, { label: `설계자: 검증 반영${tag}`, phase: '사실 검증', schema: FIX_SCHEMA, model: DEBATE_MODEL })
    if (fix) {
      CORE_KEYS.forEach(k => { state[k] = fix[k] })
      userDecisions.push(...fix.newUserDecisions)
      corrections = fix.corrections
      // 설계자 반박은 원래 검증 결과·설계자 주장을 모르는 에이전트가 새 근거로 다시 확인한다
      const disputed = corrections.filter(c => ['다른 위치에 있음', '바꿀 필요 없음'].includes(c.action))
      if (disputed.length) {
        const re = disputed.filter(d => d.newEvidence).map(d => {
          const it = items.find(i => i.id === d.id) || { claim: d.change }
          return { id: `${d.id}r`, claim: it.claim, evidence: d.newEvidence, kind: kindOf(d.newEvidence), core: !!it.core, usedIn: it.usedIn || [] }
        })
        reverify = re.length ? await checkClaims(re, `${tag} 재검증`) : []
        disputed.forEach(d => {
          const r = reverify.find(x => x.id === `${d.id}r`)
          const it = items.find(i => i.id === d.id)
          if (!r || r.status !== '확인됨') userDecisions.push({ title: `근거 엇갈림: ${it ? it.claim : d.id}`.slice(0, 120), options: `검증: ${it ? it.status : ''} / 설계자: ${d.change}${d.newEvidence ? ` (${d.newEvidence})` : ''} / 재검증: ${r ? `${r.status} ${r.actual}` : '새 근거 없음'}`, recommendation: '원본을 직접 열어 확인 후 결정' })
        })
      }
      log(`검증 반영${tag}: 핵심 ${bad.length}건 수정·표시 ${marks.length}건${reverify.length ? ` / 설계자 반박 재검증 ${reverify.length}건(확인됨 ${reverify.filter(r => r.status === '확인됨').length})` : ''}${state.outlook.verdict !== outlookBefore.verdict ? ` — 판정 변경 ${outlookBefore.verdict} → ${state.outlook.verdict}` : ''}`)
    } else log(`검증 반영${tag} 실패 — 설계안은 그대로`)
  }
  verification = { items, corrections, reverify, outlookBefore: state.outlook.verdict !== outlookBefore.verdict || state.outlook.confidence !== outlookBefore.confidence ? outlookBefore : null, pickFailed: !picked }
  return verification
}

// ── 판정자 ──
const RULING_SCHEMA = { type: 'object', properties: { rulings: { type: 'array', items: { type: 'object', properties: {
  disputeId: { type: 'string' },
  side: { type: 'string', enum: ['검토자', '설계자', '절충', '사용자'], description: '사용자는 사내 사정(예산·인력·계약·내부 일정)이 걸려 판정자가 정할 수 없을 때만' },
  decision: { type: 'string', description: '설계안에 무엇을 어떻게 반영할지 구체적으로' },
  reason: { type: 'string', description: '판정 이유 + 직접 확인한 근거(파일명 L행 "인용" 또는 URL)' },
}, required: ['disputeId', 'side', 'decision', 'reason'] } } }, required: ['rulings'] }

const JUDGE_SCHEMA = { type: 'object', properties: {
  approve: { type: 'boolean', description: '이대로 확정해도 합당하면 true(완벽이 아니라 합당함). requiredChanges가 있으면 false' },
  genreVerdict: { type: 'string', description: '판정자 자신의 장르 판정 한두 문장(설계자와 같아도 쓴다)' },
  outlook: { type: 'object', properties: {
    verdict: { type: 'string', enum: ['성공', '조건부 성공', '실패'] },
    confidence: { type: 'string', enum: ['높음', '중간', '낮음'], description: '실측 매출 자료가 없으면 높음 금지' },
    reasons: { type: 'string', description: '판정 이유(우선순위 순) — 각 이유에 검증 V번호 또는 직접 확인한 근거와 그 상태' },
  }, required: ['verdict', 'confidence', 'reasons'] },
  requiredChanges: { type: 'array', items: { type: 'object', properties: {
    id: { type: 'string', description: 'J<회차>-1, J<회차>-2 ...' },
    target: { type: 'string', description: '대상(outlook·genreVerdict·diagnosis·plan id 등)' },
    change: { type: 'string', description: '반드시 바꿔야 할 것 — 구체적으로' },
    reason: { type: 'string', description: '이유 + 직접 확인한 근거' },
  }, required: ['id', 'target', 'change', 'reason'] }, description: '틀린 사실 위에 선 결론, 근거보다 센 단정, 판정과 설계안의 불일치 등 반드시 고칠 것만. 사소한 개선 제안 금지' },
  objectionReplies: { type: 'array', items: { type: 'object', properties: { disputeId: { type: 'string' }, accept: { type: 'boolean' }, reason: { type: 'string' } }, required: ['disputeId', 'accept', 'reason'] }, description: '설계자 이의마다 하나씩. 받아들이면 requiredChanges에도 반영' },
  userOnly: { type: 'array', items: DECISION, description: '사내 사정이 걸려 판정자가 정할 수 없는 것' },
}, required: ['approve', 'genreVerdict', 'outlook', 'requiredChanges', 'objectionReplies', 'userOnly'] }

const JUDGE_ROLE = `당신은 판정자다. 설계자·검토자와 다른 모델이며 분석에 참여하지 않았다. 양쪽 글이 그럴듯한지가 아니라, 결론을 받치는 사실이 원본에 있는지로 판정한다.
- 판정에 쓰는 사실은 원본(파일·URL)을 직접 열어 확인한다. 사실 검증 결과(V번호)가 있으면 활용하되, 판정을 가르는 사실은 직접 다시 연다. 양쪽이 함께 믿는 전제일수록 의심한다.
- 기억·상식으로 사실을 만들지 않는다. 확인 못한 것은 "추정:".
- 읽기 전용이다. 어떤 파일도 수정·생성하지 않는다.`

async function judgeDisputes(threadsHot, r) {
  const res = await agent(`${JUDGE_ROLE}
설계자와 검토자가 아래 쟁점에서 같은 설계·같은 반대를 ${MEDIATE_AFTER}번 되풀이해 멈췄다. 쟁점마다 원본을 확인하고 판정한다(검토자 / 설계자 / 절충 / 사용자). 사내 사정이 걸린 것만 사용자로 넘긴다 — 판단이 어렵다는 이유로 넘기지 않는다.

현재 설계안:
${planText(state)}

쟁점:
${threadsHot.map(t => `- [${t.root}] (대상 ${t.target}) ${t.idea}\n${historyText(t)}`).join('\n')}
${settledText()}${SCOPE}`, { label: `판정자: ${r}차 쟁점 판정`, phase: '분석', schema: RULING_SCHEMA, model: STRONG_MODEL })
  if (res) judgeLog.push({ type: 'dispute', round: r, rulings: res.rulings })
  return res
}

// 검토자가 전 관점을 승인했을 때(또는 끝날 때) — 사실 검증 → 판정자 확인.
// 반환: 'agreed'(셋 모두 동의) / 'changed'(판정자 요구를 반영함 — 검토자가 다시 승인해야 함) / 'dispute'(설계자·판정자 이의 왕복이 기준을 넘음) / 'error' / 'reported'(apply=false, 판정만 기록)
async function finalCheck(r, apply) {
  const tag = ` ${r}차`
  if (VERIFY) await verifyDesign(tag)
  phase('판정')
  const j = await agent(`${JUDGE_ROLE}
설계자와 검토자가 아래 설계안에 합의했다(검토 관점 ${LENSES.map(l => l.key).join('·')} 모두 승인). 이 합의를 확정해도 되는지 판정한다.
- 판정자 자신의 장르 판정과 성공 가능성 판정을 쓴다. 설계안과 다르면 그 차이를 requiredChanges로 낸다.
- requiredChanges에는 반드시 고칠 것만 낸다: 틀렸거나 과장된 사실 위에 선 결론, 근거보다 센 단정, '추정'이 사실처럼 쓰인 곳, 판정과 plan의 불일치. 취향·사소한 개선은 내지 않는다.
- 설계자 이의가 있으면 하나씩 objectionReplies로 답한다(근거로 판단 — 받아들이면 requiredChanges에 넣는다).
- 사내 사정이 걸린 것은 userOnly로.

현재 설계안:
${planText(state)}

사실 검증 결과:
${verification ? verification.items.map(i => `- ${i.id} [${i.core ? '핵심' : '보조'} ${(i.usedIn || []).join(',')}] ${i.claim} → ${i.status}${i.actual ? `: ${i.actual}` : ''} (근거 ${i.evidence})`).join('\n') + (verification.corrections.length ? `\n설계자 반영: ${verification.corrections.map(c => `${c.id} ${c.action} — ${c.change}`).join(' / ')}` : '') + (verification.reverify.length ? `\n설계자 반박 재검증: ${verification.reverify.map(x => `${x.id} ${x.status}`).join(', ')}` : '') : '(검증 안 함)'}

설계자 이의(이전 판정에 대한):
${designerObjections.map(o => `- [${o.disputeId}] ${o.idea}: ${o.objection}`).join('\n') || '(없음)'}

이전 판정 기록:
${judgeLog.filter(x => x.type === 'final').map(x => `- ${x.round}차: ${x.approve ? '승인' : '미승인'} ${x.requiredChanges.map(c => `${c.id} ${c.change}`).join(' / ')}`).join('\n') || '(없음)'}
${settledText()}${SCOPE}`, { label: `판정자: ${r}차 최종 확인`, phase: '판정', schema: JUDGE_SCHEMA, model: STRONG_MODEL })
  if (!j) return 'error'
  judgeLog.push({ type: 'final', round: r, ...j })
  userDecisions.push(...j.userOnly)
  log(`판정자 ${r}차: ${j.approve && !j.requiredChanges.length ? '승인' : `미승인 — 고칠 것 ${j.requiredChanges.length}건`} / 판정 ${j.outlook.verdict}(확신도 ${j.outlook.confidence})${j.outlook.verdict !== state.outlook.verdict ? ` — 설계안은 ${state.outlook.verdict}` : ''}`)
  if (!apply) return 'reported'

  if (j.requiredChanges.length) {
    objectionRounds = 0
    const res = await applyDecisions('판정자', j.requiredChanges.map(c => ({ id: c.id, target: c.target, idea: c.change, decision: `${c.change} (이유: ${c.reason})` })), '', `설계자: 판정 반영 ${r}차`, '판정')
    return res ? 'changed' : 'error'
  }
  // 판정자는 승인했지만 설계자 이의를 기각했다면, 설계자가 받아들이는지 확인한다(셋이 모두 동의해야 끝)
  const rejected = designerObjections.filter(o => { const rep = j.objectionReplies.find(x => x.disputeId === o.disputeId); return !rep || !rep.accept })
  if (!rejected.length) { designerObjections = []; return 'agreed' }
  const CONFIRM_SCHEMA = { type: 'object', properties: { replies: { type: 'array', items: { type: 'object', properties: {
    disputeId: { type: 'string' }, agree: { type: 'boolean' },
    newEvidence: { type: 'string', description: 'agree=false면 판정자가 아직 보지 않은 새 근거(파일명 L행 "인용" 또는 URL). 같은 주장 되풀이 금지 — 새 근거가 없으면 agree=true' },
  }, required: ['disputeId', 'agree', 'newEvidence'] } } }, required: ['replies'] }
  const c = await agent(`당신은 ${NAME} 게임 디자인 총괄(설계자)이다. 판정자가 당신의 이의를 아래 이유로 받아들이지 않았다. 판정자 이유를 원본과 함께 따져 보고, 받아들이면 agree=true. 판정자가 아직 보지 않은 새 근거가 있을 때만 agree=false와 newEvidence를 쓴다.

${rejected.map(o => { const rep = j.objectionReplies.find(x => x.disputeId === o.disputeId); return `- [${o.disputeId}] ${o.idea}\n  내 이의: ${o.objection}\n  판정자: ${rep ? rep.reason : '(답 없음 — 기각으로 봄)'}` }).join('\n')}
${SCOPE}`, { label: `설계자: 판정 수용 확인 ${r}차`, phase: '판정', schema: CONFIRM_SCHEMA, model: DEBATE_MODEL })
  if (!c) return 'error'
  const still = rejected.filter(o => { const x = c.replies.find(y => y.disputeId === o.disputeId); return x && !x.agree && x.newEvidence })
  if (!still.length) { designerObjections = []; return 'agreed' }
  objectionRounds++
  designerObjections = still.map(o => ({ ...o, objection: `${o.objection} / 새 근거: ${c.replies.find(y => y.disputeId === o.disputeId).newEvidence}` }))
  log(`설계자가 판정자 판정 ${still.length}건에 새 근거로 이의 (${objectionRounds}/${MEDIATE_AFTER || '∞'})`)
  if (MEDIATE_AFTER > 0 && objectionRounds >= MEDIATE_AFTER) return 'dispute'
  return finalCheck(r, apply)
}

if (RESUME && (RESUME.disputes || []).length) {
  if (!MEDIATION) return { error: '중재 내용 없음', stopReason: 'needs_mediation', resume: RESUME }
  phase('중재 반영')
  const disputes = RESUME.disputes
  const med = await applyDecisions('사용자', disputes.map(d => ({ id: d.id, target: d.target, idea: d.idea, history: historyText(d) })), MEDIATION, '설계자: 중재 반영', '중재 반영')
  if (!med) return { error: '중재 반영 실패', stopReason: 'agent_error', resume: RESUME }
  designerObjections = designerObjections.filter(o => !disputes.some(d => d.id === o.disputeId))
  objectionRounds = 0
  open = open.filter(o => !disputes.some(d => d.id === (o.thread || o.id)))
  mediationResult = { text: MEDIATION, applied: med.applied }
  lensApproved.clear() // 설계안이 바뀌었으니 이전 승인은 무효 — 셋이 모두 동의해야 끝난다
  log(`중재 반영: 쟁점 ${disputes.length}건 확정`)
}

phase('분석')
const LAST = START + SAFETY_MAX_ROUNDS - 1
for (let r = START; r <= LAST; r++) {
  const lens = LENSES[(r - 1) % LENSES.length]
  const priorBlock = open.length
    ? open.map(o => { const t = threads[o.thread]; return `- ${o.id} ${o.idea}${t && backAndForth(t) > 0 ? ` (같은 설계·같은 반대 ${backAndForth(t)}번 되풀이)` : ''}\n  직전 검토자 주장: ${lastObjection(t)}\n  설계자 판단(${o.ev.judgement}): ${o.ev.reason}${o.ev.counterProposal ? `\n  역제안: ${o.ev.counterProposal}` : ''}` }).join('\n')
    : '(없음 — priorVerdicts 빈 배열)'
  const pastDeclined = Object.values(threads).filter(t => t.status === 'open' && !open.some(o => o.thread === t.root))
  const pastBlock = pastDeclined.length ? `\n이전에 설계자가 비채택·변형해 닫힌 제안(같은 취지를 다시 내면 repeatOf에 그 id):\n` + pastDeclined.map(t => `- ${t.ids[t.ids.length - 1]} ${t.idea}`).join('\n') + '\n' : ''

  const review = await agent(`당신은 ${r}차 검토자(시니어 게임 디자이너)다. 이번 관점: ${lens.desc}
설계자의 추론은 보지 못하며, 현재 설계안과 원 자료·외부 조사로만 판단한다. 필요하면 새로 조사해 newResearch에 남긴다.

현재 설계안:
${planText(state)}

이전 라운드에서 설계자가 그대로 채택하지 않은 제안(각각 agree/disagree):
${priorBlock}
${pastBlock}${settledText()}
해야 할 일:
1. 이전 판정 대상에 agree/disagree. 설계자의 역제안이 원 제안과 같거나 낫다면 agree.
   disagree하려면 직전 주장과 다른 것을 내야 한다 — 새 근거(조사·데이터·사례), 다른 각도의 문제 지적, 또는 양쪽 우려를 함께 푸는 절충안. 직전 주장을 말만 바꿔 되풀이하지 않는다. 새로 낼 것이 없으면 agree하거나 물러선다.
   그래도 같은 반대를 새 근거 없이 되풀이할 수밖에 없으면 sameObjection=true로 솔직하게 표시한다.
2. 이번 관점에서 실질적으로 나아지는 제안만: better_approach / simplify / fix_flaw / missing / more_detail / out_of_scope / direction_change(큰 방향 자체를 바꾸자는 제안). 이전에 닫힌 제안과 같은 취지면 repeatOf에 그 id를 쓰고, 이전과 달라진 근거·형태를 분명히 한다(새 근거 없이 같은 주장이면 sameObjection=true).
3. 이 관점에서 '이대로 개발 기획에 착수해도 합당하다'면 planApproved=true (그때 사소한 제안을 덧붙이지 않는다). 완벽이 아니라 합당함이 기준.
4. 제안 id는 R${r}-1, R${r}-2 ...
${SCOPE}`, { label: `검토자 ${r}차 (${lens.key})`, phase: '분석', schema: REVIEW_SCHEMA, model: DEBATE_MODEL })

  if (!review) { stopReason = 'agent_error'; log(`${r}차: 검토자 실패`); break }

  review.proposals.forEach(p => {
    const t = p.repeatOf ? threadOf(p.repeatOf) : null
    p.thread = t ? t.root : p.id
  })
  const disagreed = open.filter(o => review.priorVerdicts.some(v => v.proposalId === o.id && v.verdict === 'disagree'))
  const agreed = review.priorVerdicts.filter(v => v.verdict === 'agree').length
  review.priorVerdicts.filter(v => v.verdict === 'agree').forEach(v => { const t = threadOf(v.proposalId); if (t) t.status = 'resolved' })
  const toEval = [...disagreed, ...review.proposals]
  log(`${r}차(${lens.key}): 동의 ${agreed} / 이견 ${disagreed.length} / 새 제안 ${review.proposals.length}${review.proposals.some(p => p.repeatOf) ? `(재제기 ${review.proposals.filter(p => p.repeatOf).length})` : ''} / ${review.planApproved ? '승인' : '미승인'}`)

  if (review.planApproved && toEval.length === 0) {
    lensApproved.add(lens.key)
    rounds.push({ round: r, lens: lens.key, review, response: null })
    open = []
    if (lensApproved.size === LENSES.length) {
      // 검토자 전 관점 승인 → 사실 검증 → 판정자 확인. 셋(설계자·검토자·판정자)이 모두 동의해야 끝난다.
      log(`${r}차: ${LENSES.length}개 관점 모두 승인 — 사실 검증·판정자 확인`)
      const fc = await finalCheck(r, true)
      phase('분석')
      if (fc === 'agreed') { stopReason = 'consensus'; log(`${r}차: 설계자·검토자·판정자 모두 동의 — 합의`); break }
      if (fc === 'error') { stopReason = 'agent_error'; break }
      if (fc === 'dispute') { stopReason = 'needs_mediation'; log(`${r}차: 설계자·판정자 이의 ${MEDIATE_AFTER}번 왕복 — 사용자 중재 요청`); break }
      // 'changed': 판정자 요구가 설계안에 반영됐으니 검토자가 처음부터 다시 승인해야 한다
      lensApproved.clear()
      log(`${r}차: 판정자 요구 반영 — 검토자 전 관점 재승인 필요`)
    }
    continue
  }
  lensApproved.delete(lens.key)

  const response = await agent(`당신은 ${NAME} 게임 디자인 총괄(설계자)이다. ${r}차 검토자(관점: ${lens.key})의 제안을 하나씩 합당성 판단하고 설계안을 개선하라. 필요하면 직접 추가 조사.

현재 설계안:
${planText(state)}

검토자가 새로 조사한 사실:
${review.newResearch.map(f => `- ${f.claim} (${f.evidence})`).join('\n') || '(없음)'}

판단할 제안:
${toEval.map(o => `- ${o.id} (${o.kind}) [대상 ${o.target}] ${o.idea}\n  이득: ${o.benefit}\n  비용: ${o.cost}\n  근거: ${o.evidence}` + (disagreed.includes(o) ? `\n  직전 설계자 판단(${o.ev.judgement}): ${o.ev.reason}${o.ev.counterProposal ? ` / 역제안: ${o.ev.counterProposal}` : ''}\n  검토자 이견: ${(review.priorVerdicts.find(v => v.proposalId === o.id) || {}).reason || ''}` : '') + (o.repeatOf ? `\n  (이전 제안 ${o.repeatOf}의 재제기)` : '')).join('\n')}

검토자 판정: ${review.planApproved ? '승인' : '미승인'} — ${review.approvalReason}
${settledText()}
판단: adopt / adapt(더 나은 형태로 변형, counterProposal) / decline(현재가 더 합당) / escalate(사내 사정이라 사용자 결정 — newUserDecisions).
direction_change 제안은 기존 방향을 지키려고 기각하지 말고, 근거를 같은 무게로 비교해 판단한다.
같은 쟁점이 되풀이되면 직전 판단·역제안을 그대로 되풀이하지 않는다 — 검토자의 새 근거를 반영하거나, 양쪽 우려를 함께 푸는 다른 역제안(범위·시점·수치·대상 조정 등)을 찾거나, 새 근거로 판단을 바꾼다. 정말 더 나은 대안이 없을 때만 이전 판단을 짧게 유지한다(긴 재반박 금지).
판단마다 sameDesign을 표시한다 — 이전 판단·역제안을 그대로 유지하고 설계안을 바꾸지 않았으면 true, 실제로 고쳤거나 새 역제안을 냈으면 false.
항목 수가 불어나지 않게 유지한다 — 새 항목보다 기존 항목 보강·통합을 우선하고, 중복은 합친다. 1차(필수) 범위를 늘릴 때는 무엇을 뒤로 미룰지 함께 정한다.
plan은 반영 끝난 전체(id 유지, 새 항목은 이어 번호).
${SCOPE}`, { label: `설계자 ${r}차 판단`, phase: '분석', schema: RESPONSE_SCHEMA, model: DEBATE_MODEL })

  rounds.push({ round: r, lens: lens.key, review, response })
  if (!response) { stopReason = 'agent_error'; log(`${r}차: 설계자 실패`); break }

  CORE_KEYS.forEach(k => { state[k] = response[k] })
  userDecisions.push(...response.newUserDecisions)
  const evald = toEval.map(o => ({ ...o, thread: o.thread || o.id, ev: response.evaluations.find(e => e.proposalId === o.id) })).filter(o => o.ev)
  const cnt = j => evald.filter(o => o.ev.judgement === j).length
  evald.forEach(o => {
    const t = threads[o.thread] || (threads[o.thread] = { root: o.thread, idea: o.idea, target: o.target, ids: [], exchanges: [], status: 'open' })
    if (!t.ids.includes(o.id)) t.ids.push(o.id)
    const prior = review.priorVerdicts.find(v => v.proposalId === o.id)
    // evald 항목은 복사본이라 disagreed.includes(o)로는 찾지 못한다 — id로 비교한다
    const isDisagreed = disagreed.some(d => d.id === o.id)
    const sameObjection = isDisagreed ? !!(prior && prior.sameObjection) : !!(o.repeatOf && o.sameObjection)
    t.exchanges.push({ round: r, lens: lens.key, reviewer: isDisagreed ? `(이견) ${prior ? prior.reason : ''}` : `${o.idea} — ${o.benefit}`, judgement: o.ev.judgement, reason: o.ev.reason, counter: o.ev.counterProposal, same: sameObjection && !!o.ev.sameDesign })
    t.status = ['adopt', 'escalate'].includes(o.ev.judgement) ? 'resolved' : 'open'
  })
  open = evald.filter(o => ['adapt', 'decline'].includes(o.ev.judgement))
  log(`${r}차 설계자: 채택 ${cnt('adopt')} / 변형 ${cnt('adapt')} / 비채택 ${cnt('decline')} / 사용자결정 ${cnt('escalate')} / 항목 ${state.plan.length}개`)

  let judged = false
  if (MEDIATE_AFTER > 0) {
    hot = Object.values(threads).filter(t => t.status === 'open' && backAndForth(t) >= MEDIATE_AFTER)
    if (hot.length) {
      // 판정자가 원본을 확인해 먼저 판정하고, 사내 사정이 걸린 것만 사용자에게 넘긴다
      log(`${r}차: 같은 설계·같은 반대 ${MEDIATE_AFTER}번 되풀이(${hot.map(t => t.root).join(', ')}) — 판정자 판정`)
      const ruled = await judgeDisputes(hot, r)
      if (!ruled) { stopReason = 'agent_error'; log(`${r}차: 판정자 실패`); break }
      const sideOf = t => (ruled.rulings.find(x => x.disputeId === t.root) || { side: '사용자' }).side
      const decided = hot.filter(t => sideOf(t) !== '사용자')
      if (decided.length) {
        const res = await applyDecisions('판정자', decided.map(t => { const x = ruled.rulings.find(y => y.disputeId === t.root); return { id: t.root, target: t.target, idea: t.idea, decision: `${x.side} 쪽으로 — ${x.decision} (이유: ${x.reason})` } }), '', `설계자: ${r}차 판정 반영`, '분석')
        if (!res) { stopReason = 'agent_error'; break }
        open = open.filter(o => !decided.some(t => t.root === o.thread))
        lensApproved.clear()
        judged = true
        log(`${r}차: 판정자 판정 ${decided.length}건 반영(${decided.map(t => `${t.root}→${sideOf(t)}`).join(', ')})${res.objections.length ? ` / 설계자 이의 ${res.objections.length}건 — 최종 판정 때 판정자가 봄` : ''}`)
      }
      hot = hot.filter(t => sideOf(t) === '사용자')
      if (hot.length) { stopReason = 'needs_mediation'; log(`${r}차: 사내 사정이 걸린 쟁점 ${hot.length}건 — 사용자 중재 요청`); break }
    }
  }
  // 중재가 켜져 있으면 교착이어도 멈추지 않는다 — 같은 설계·같은 반대가 MEDIATE_AFTER번 되풀이되면 위에서 중재로 멈춘다.
  if (!judged && r > START && review.proposals.length === 0 && agreed === 0 && cnt('adopt') === 0 && cnt('adapt') === 0 && cnt('escalate') === 0) {
    if (MEDIATE_AFTER > 0 && open.length) log(`${r}차: 교착 — 중재 기준까지 계속`)
    else { stopReason = 'deadlock'; log(`${r}차: 교착`); break }
  }
  if (r === LAST) { stopReason = 'safety_cap'; log(`안전장치 ${SAFETY_MAX_ROUNDS}차 도달`) }
}

// 합의 없이 끝났으면(안전장치·교착) 결과를 고치지 않고 사실 검증과 판정자 판정만 기록한다
if (['safety_cap', 'deadlock'].includes(stopReason) && state.plan) await finalCheck(START + rounds.length - 1, false)

const disputes = stopReason !== 'needs_mediation' ? []
  : hot.length ? hot.map(t => ({ id: t.root, idea: t.idea, target: t.target, ids: t.ids, exchanges: t.exchanges }))
  : designerObjections.map(o => {
    const last = judgeLog.filter(x => x.type === 'final').slice(-1)[0] || { objectionReplies: [] }
    const rep = (last.objectionReplies || []).find(x => x.disputeId === o.disputeId)
    return { id: o.disputeId, idea: o.idea, target: '판정자 판정', ids: [o.disputeId], exchanges: [{ round: last.round, lens: '판정자', reviewer: rep ? rep.reason : '판정 유지', judgement: 'decline', reason: o.objection, counter: '' }] }
  })
const lastRound = rounds.length ? rounds[rounds.length - 1].round : START - 1

return {
  stopReason, roundCount: rounds.length, startRound: START, game: NAME,
  research, initialDesign: design, mediation: mediationResult, rounds,
  final: state,
  verification,
  judge: { model: STRONG_MODEL, debateModel: DEBATE_MODEL, log: judgeLog, last: judgeLog.filter(x => x.type === 'final').slice(-1)[0] || null, pendingObjections: designerObjections },
  lensApproved: [...lensApproved],
  userDecisions: userDecisions.filter((p, i, a) => a.findIndex(q => q.title.slice(0, 30) === p.title.slice(0, 30)) === i),
  unresolved: open.map(o => ({ id: o.id, idea: o.idea, judgement: o.ev.judgement, reason: o.ev.reason, counter: o.ev.counterProposal })),
  settled,
  disputes,
  resume: stopReason === 'needs_mediation'
    ? { state, open, lensApproved: [...lensApproved], userDecisions, threads, settled, nextRound: lastRound + 1, disputes, designerObjections, objectionRounds, judgeLog }
    : null,
}

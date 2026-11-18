// 기본 정리 — AI 없이 받아 적은 글에서 "중요해 보이는 문장"을 규칙으로 골라낸다.
// API 키가 없어도, 인터넷이 없어도 동작한다. 결과 모양은 Claude 정리와 같다.
'use strict';

// ── 문장 나누기 ──
function splitSentences(text) {
  const rough = String(text || '')
    .replace(/\s+/g, ' ')
    .split(/(?<=[.?!。])\s+|(?<=(?:니다|세요|어요|아요|해요|죠|네요|까요|군요|고요|구요|합시다|시다))\s+(?=[가-힣A-Za-z0-9])/);
  const out = [];
  for (let s of rough) {
    s = s.trim();
    if (!s) continue;
    // "~하기로 하고 ~" 처럼 두 가지 이야기가 이어진 긴 문장은 둘로 나눈다
    const parts = s.split(/(?<=기로 하고|기로 했고|기로 하구요|주시고|하시고|고요,|구요,)\s+/);
    for (const p of parts) if (p.trim()) out.push(p.trim());
  }
  return out;
}

// ── 패턴 ──
const FILLER = /^(네|예|아|어|음|응|그|저|자|좋습니다|알겠습니다|감사합니다|수고하셨습니다|네네|넵)[.!?,\s]*$/;

const OPEN_Q = [
  /\?$/,
  /다음\s?(회의|미팅|시간)에(서)?/,
  /추후|나중에\s?(다시|논의|정하|결정)/,
  /다시\s?(논의|정하|정해|검토|이야기|얘기)/,
  /확인(이)?\s?필요|확인해\s?봐야/,
  /미정|보류/,
  /(할지|갈지|될지|맞는지|가능한지|어떻게\s?할지)\s?(는|를|도)?\s/,
  /고민(해\s?봐야|이\s?필요|중)/,
  /검토해\s?(봐야|보겠|볼게)/,
  /여부(는|를)?/,
  /아직|협의\s?중|확정\s?(못|안)|결정\s?(못|안)|정하지\s?못/,
  /(결정|정)(합시다|하죠)/,
  /다시\s?모여/,
];

const ACTION = [
  /(해|하|만들어|보내|확인해|준비해|정리해|공유해|올려|챙겨|검토해|알아봐|전달해|요청해|작성해|수정해|업데이트해|연락해|잡아|맞춰|받아|넘겨|드려|봐)\s?(주세요|주시고|주십시오|줘요|주시면|주실래요|주시겠어요|주셔야)/,
  /(하겠습니다|할게요|하겠어요|할\s?게요|드리겠습니다|드릴게요|보겠습니다|볼게요|받겠습니다|올리겠습니다|보내겠습니다|공유하겠습니다)/,
  /부탁(드립니다|드려요|해요|합니다|드릴게요)/,
  /해야\s?(합니다|돼요|됩니다|해요|겠|할|하는)/,
  /담당(해|하|은|는|자)/,
  /(해|하|보내|만들어|정리해|준비해|확인해|드려|알려)\s?주기로/,
];

const DECISION = [
  /결정(했|됐|되었|하였|합니다|입니다|하겠|으로)/,
  /확정(했|됐|되었|합니다|입니다|으로|하겠)/,
  /(하기로|가기로|쓰기로|진행하기로|적용하기로|사용하기로|바꾸기로|받기로|맞추기로)\s?(했|하였|결정|정했|합의|됐|하겠|합니다)/,
  /정했습니다|정했어요|정하겠습니다|정해졌/,
  /합의(했|됐|되었|합니다)/,
  /승인(했|됐|되었|합니다|받았)/,
  /(으로|로)\s?(가겠습니다|갑니다|진행하겠습니다|진행합니다)/,
  /기로\s?(했|하였|합의|됐|정했)/,
];
// "확정 못 했습니다", "아직 협의 중" 은 결정이 아님
const NEGATED = /(못|안)\s?(했|정했|됐|합니다)|아직|협의\s?중|미정/;

// 기한
const DUE = new RegExp(
  [
    '(?:오늘|내일|모레|글피)(?:\\s?(?:오전|오후|저녁|중))?',
    '(?:이번|다음|다다음)\\s?(?:주|달)(?:\\s?[월화수목금토일]요일)?(?:\\s?(?:초|말))?',
    '(?:이번|다음)\\s?분기',
    '[월화수목금토일]요일',
    '\\d{1,2}\\s?월\\s?\\d{1,2}\\s?일',
    '\\d{1,2}\\s?일',
    '\\d{1,2}\\s?/\\s?\\d{1,2}',
    '(?:월말|월초|주말|연말|연초|이번\\s?달\\s?말)',
  ].join('|'),
);
// "까지" / "안에" 가 붙은 기한만 할 일 기한으로 본다
const DUE_TAIL = new RegExp(`(${DUE.source})(?:\\s?(?:까지|안에|중으로|내로|전에))`);

// 담당자: "박지현님이", "품질팀에서", "김 과장이"
const TITLES = '님|씨|팀장님|팀장|팀|과장님|과장|대리님|대리|부장님|부장|차장님|차장|주임|사원|매니저님|매니저|실장님|실장|선임|책임';
const OWNER = new RegExp(`([가-힣]{1,4}?)\\s?(${TITLES})(?:이|가|께서|에서|은|는|이랑|하고)?(?=\\s)`);
const NOT_NAMES = new Set(['우리', '저희', '다른', '해당', '전체', '이번', '다음', '모든', '각자', '본인', '상대', '관련', '고객']);

function findOwner(s) {
  const m = s.match(OWNER);
  if (!m || NOT_NAMES.has(m[1])) return null;
  // "최대리", "김과장"처럼 성+직함은 되지만 한 글자+님/씨/팀은 이름이 아님
  if (m[1].length === 1 && ['님', '씨', '팀'].includes(m[2])) return null;
  const title = m[2];
  // "품질팀", "박지현님", "김민수 대리님"
  if (title === '팀' || title === '님' || title === '씨' || m[1].length === 1) return `${m[1]}${title}`;
  return `${m[1]} ${title}`;
}

// "바꿀지는", "할지", "갈지를" — ㄹ받침 + 지 (아직 안 정한 것)
function hasUndecided(s) {
  const re = /([가-힣])지(?:는|를|도)?(?=\s|$)/g;
  let m;
  while ((m = re.exec(s))) {
    if ((m[1].charCodeAt(0) - 0xac00) % 28 === 8) return true;
  }
  return false;
}

// 회의 진행 멘트는 할 일이 아님
const PROCEDURE = /^(?:(?:그럼|그러면|자|네|예|이제)\s*,?\s*)*(회의\s?)?(시작|마치|마무리|끝내|넘어가|정리하|이어가)(겠습니다|할게요|하겠습니다|죠|ㅂ시다|합시다)/;
const REQUEST = /주세요|주시고|주십시오|주시면|부탁/;
// "오늘은 ~ 보겠습니다", "다음은 ~ 이야기하겠습니다" 같은 안건 소개는 할 일이 아니라 주요 내용
const AGENDA = /^(오늘은|오늘|먼저|우선|다음은|다음으로|이번에는|이번엔|그다음은?|마지막으로)\s.*(보겠습니다|볼게요|보죠|봅시다|이야기하겠습니다|얘기하겠습니다|논의하겠습니다|다루겠습니다|하겠습니다|합니다)[.!]?$/;

function findDue(s) {
  const m = s.match(DUE_TAIL);
  return m ? m[1].replace(/\s+/g, ' ').trim() : null;
}

// ── 핵심 단어 (제목·주요 내용 고르기용) ──
const PARTICLES = /(으로부터|에서부터|이라고|라고|에서는|에서도|에게서|으로는|으로도|까지는|까지도|부터는|에서|에게|으로|이랑|하고|까지|부터|처럼|보다|이나|이라|은|는|이|가|을|를|에|의|로|와|과|도|만|랑|께)$/;
const VERBISH = /(습니다|니다|어요|아요|해요|세요|었|았|겠|했|하고|해서|인데|는데|지만|면서|거든|네요|죠|고요|구요|하는|하면|해야|되는|된|될|한|할|함|하기|되기|있는|없는|같은|같아|같습|이고|이며|하게|되게|합시다|시다|니까|려서|어서|아서|워서|여서|비해|해|돼|님|씨|대리|과장|부장|차장|팀장)$/;
const STOP = new Set(
  '오늘 회의 이번 다음 그리고 그래서 그러면 그런데 근데 일단 제가 저희 우리 이거 그거 저거 지금 다시 그냥 이제 좀 진짜 정말 혹시 아마 이렇게 그렇게 어떻게 무엇 뭐 여기 거기 때문 정도 부분 경우 관련 내용 이야기 얘기 생각 말씀 확인 진행 하나 두 세 네 예 아니 맞아 맞습니다 감사합니다 수고 하셨습니다 있습니다 없습니다 합니다 됩니다 같습니다 그거는 이거는 그러니까 일단은 거의 많이 조금 너무 아주 먼저 나중 바로 계속 항상 모두 전부 각각'.split(' '),
);

function keywords(sentence) {
  return (sentence.match(/[가-힣A-Za-z0-9]{2,}/g) || [])
    .map((w) => w.replace(PARTICLES, ''))
    .filter((w) => w.length >= 2 && !STOP.has(w) && !VERBISH.test(w) && !/\d/.test(w));
}

function tidy(s, max = 90) {
  s = s.replace(/^(그리고|그래서|그러면|근데|그런데|아|음|네|자)\s*,?\s*/, '').trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function extractBasicMinutes(transcript, { durationSec = 0 } = {}) {
  const sentences = splitSentences(transcript).filter((s) => s.length >= 6 && !FILLER.test(s));
  const decisions = [];
  const actions = [];
  const open = [];
  const rest = [];

  for (const s of sentences) {
    if (PROCEDURE.test(s)) continue;
    if (AGENDA.test(s) && !REQUEST.test(s)) { rest.push(s); continue; }
    const due = findDue(s);
    const isOpen = OPEN_Q.some((re) => re.test(s)) || hasUndecided(s);
    const isAction = ACTION.some((re) => re.test(s));
    const isDecision = DECISION.some((re) => re.test(s)) && !NEGATED.test(s);
    // "다음 회의에서 다시 정하겠습니다"처럼 미뤄 둔 것은 확인 필요 (기한 있는 부탁만 예외)
    if (isOpen && !(REQUEST.test(s) && due)) open.push(tidy(s));
    // "이번 주 안에 받기로 하고"처럼 결정 표현이라도 기한이 붙으면 할 일
    else if (isAction || ((isDecision || /기로/.test(s)) && due)) actions.push({ task: tidy(s), owner: findOwner(s), due });
    else if (isDecision) decisions.push(tidy(s));
    else rest.push(s);
  }

  // 자주 나온 단어 → 제목, 그 단어가 많이 든 문장 → 주요 내용
  const freq = new Map();
  for (const s of sentences) for (const w of new Set(keywords(s))) freq.set(w, (freq.get(w) || 0) + 1);
  const top = [...freq.entries()].sort((a, b) => b[1] - a[1] || b[0].length - a[0].length).map(([w]) => w);
  const title = top.length ? `${top.slice(0, 2).join('·')} 회의` : '회의';

  const ranked = rest
    .map((s, i) => ({ s, i, score: keywords(s).reduce((a, w) => a + (freq.get(w) || 0), 0) / Math.sqrt(keywords(s).length || 1) }))
    .filter((x) => x.s.length >= 12)
    .sort((a, b) => b.score - a.score);
  const picked = new Set(ranked.slice(0, 5).map((x) => x.i));
  const scored = ranked.slice(0, 5).sort((a, b) => a.i - b.i).map((x) => tidy(x.s));
  // 어느 칸에도 안 들어간 문장도 버리지 않고 "기타 내용"으로 전부 남긴다
  const others = rest.filter((s, i) => !picked.has(i)).map((s) => tidy(s, 200));

  const mins = Math.max(1, Math.round(durationSec / 60));
  const counts = [
    decisions.length && `결정 ${decisions.length}건`,
    actions.length && `할 일 ${actions.length}건`,
    open.length && `확인 필요 ${open.length}건`,
  ].filter(Boolean);
  const summary = sentences.length
    ? `약 ${mins}분 회의에서 ${counts.length ? counts.join(', ') + '을' : '중요 문장을'} 말투로 골라냈어요. AI 정리가 아니라서 빠지거나 잘못 분류된 것이 있을 수 있어요.`
    : '받아 적은 말이 거의 없어요.';

  return {
    method: 'basic',
    title,
    summary,
    decisions,
    action_items: actions,
    key_points: scored,
    open_questions: open,
    others,
  };
}

// PC 앱(Node)과 핸드폰 웹앱(브라우저) 양쪽에서 같은 파일을 쓴다
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { extractBasicMinutes, splitSentences, findOwner, findDue };
} else {
  window.BasicMinutes = { extractBasicMinutes, splitSentences, findOwner, findDue };
}

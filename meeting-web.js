// 핸드폰 웹앱 회의록 — 핸드폰 음성 인식으로 받아 적고, 규칙으로 정리해 메모장에 남긴다.
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const ham = window.hamster;
  const MEETINGS_KEY = 'hamster-meetings';
  const LIVE_KEY = 'hamster-meeting-live'; // 녹음 중 새로고침·앱 종료에 대비한 임시 저장

  // ── 저장 (이 핸드폰 브라우저 안) ──
  const store = {
    get(key, fallback) {
      try { return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback; } catch { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
    },
    del(key) { try { localStorage.removeItem(key); } catch {} },
  };
  const loadMeetings = () => store.get(MEETINGS_KEY, []);
  function saveMeeting(rec) {
    const all = loadMeetings().filter((m) => m.id !== rec.id);
    all.unshift(rec);
    if (!store.set(MEETINGS_KEY, all)) ham.say('저장 공간이 부족해요. 오래된 회의록을 지워 주세요', 6000);
  }

  // ── 화면 전환 (메모 / 회의록) ──
  const views = { notes: $('view-notes'), meeting: $('view-meeting') };
  function setMode(mode) {
    document.querySelectorAll('.mode').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.mode === mode)));
    for (const [k, el] of Object.entries(views)) el.hidden = k !== mode;
  }
  document.querySelectorAll('.mode').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));

  // ── 음성 인식 지원 확인 ──
  const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
  const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  if (!SpeechRec) {
    $('m-unsupported').hidden = false;
    $('m-unsupported-msg').textContent = isIOS
      ? (standalone
          ? '홈 화면 앱에서는 음성 인식이 막혀 있을 수 있어요. Safari에서 이 주소를 직접 열어 회의를 시작해 주세요. (설정 › Siri 및 검색에서 받아쓰기도 켜져 있어야 해요)'
          : '설정 › 일반 › 키보드에서 "받아쓰기 활성화"를 켜고 Safari로 열어 주세요.')
      : 'Chrome 브라우저로 열어 주세요.';
    $('m-start').disabled = true;
  }

  // ── 녹음(받아 적기) ──
  let recording = false;
  let rec = null;
  let sessions = []; // 음성 인식이 끊겼다 다시 켜질 때마다 한 덩어리
  let current = ''; // 지금 듣고 있는 덩어리 (아직 확정 전 포함)
  let meetingId = '';
  let startedAt = 0;
  let timer = null;
  let wakeLock = null;
  let restartTimer = null;
  let fatalError = '';

  const fmtDur = (sec) => {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = Math.floor(sec % 60);
    const mm = String(m).padStart(2, '0');
    const ss = String(s).padStart(2, '0');
    return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
  };

  // sessions: [{t: 회의 시작부터 몇 초, text}] — 엑셀 "원문" 시트의 시각으로 쓴다
  let sessionAt = 0;
  function segmentsSoFar() {
    const segs = sessions.slice();
    if (current.trim()) segs.push({ t: sessionAt, text: current.trim() });
    return segs;
  }
  function transcriptSoFar() {
    return segmentsSoFar().map((s) => s.text).join('\n');
  }

  function saveLive() {
    if (!recording) return;
    store.set(LIVE_KEY, { id: meetingId, startedAt, transcript: transcriptSoFar(), segments: segmentsSoFar(), savedAt: Date.now() });
  }

  function renderLive() {
    const box = $('m-live-text');
    box.innerHTML = '';
    for (const s of sessions) box.appendChild(el('p', null, s.text));
    if (current.trim()) box.appendChild(el('p', 'interim', current.trim()));
    box.scrollTop = box.scrollHeight;
  }

  // 결과 목록을 한 줄로 합친다. 일부 기기는 앞 결과를 포함한 "누적" 문장을 다시 보내므로 겹치면 바꿔 끼운다.
  function joinResults(results) {
    const parts = [];
    for (let i = 0; i < results.length; i++) {
      const t = (results[i][0] && results[i][0].transcript || '').trim();
      if (!t) continue;
      const prev = parts[parts.length - 1];
      if (prev && t.startsWith(prev)) parts[parts.length - 1] = t;
      else if (prev && prev.startsWith(t)) continue;
      else parts.push(t);
    }
    return parts.join(' ');
  }

  function commitCurrent() {
    if (current.trim()) sessions.push({ t: sessionAt, text: current.trim() });
    current = '';
  }

  let active = false; // 음성 인식이 지금 켜져 있는지

  function startRecognizer() {
    clearTimeout(restartTimer);
    if (active) return;
    rec = new SpeechRec();
    rec.onstart = () => { active = true; };
    rec.lang = 'ko-KR';
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    rec.onresult = (e) => {
      if (!current) sessionAt = Math.round((Date.now() - startedAt) / 1000);
      current = joinResults(e.results);
      ham.nod(); // 말이 들리면 끄덕끄덕
      renderLive();
      saveLive();
      $('m-rec-sub').textContent = '받아 적는 중';
    };
    rec.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        fatalError = isIOS
          ? '마이크·음성 인식이 막혀 있어요. 설정 › Safari › 마이크를 "허용"으로 바꾸고, 받아쓰기를 켜 주세요.'
          : '마이크 권한이 막혀 있어요. 주소창 옆 자물쇠에서 마이크를 허용해 주세요.';
      } else if (e.error === 'audio-capture') {
        fatalError = '마이크를 찾을 수 없어요.';
      }
      // no-speech, network, aborted 등은 onend에서 다시 켠다
    };
    rec.onend = () => {
      active = false;
      commitCurrent();
      renderLive();
      saveLive();
      if (!recording) return;
      if (fatalError) {
        ham.say('마이크를 쓸 수 없어요', 5000);
        stopMeeting(true);
        return;
      }
      // 조용하면 기기가 인식을 끝내 버리므로 회의가 끝날 때까지 계속 다시 켠다
      restartTimer = setTimeout(() => {
        if (recording && !document.hidden) {
          try { startRecognizer(); } catch { restartTimer = setTimeout(startRecognizer, 1000); }
        }
      }, 250);
    };
    rec.start();
  }

  async function keepScreenOn() {
    try {
      if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen');
    } catch {}
  }

  document.addEventListener('visibilitychange', () => {
    if (!recording) return;
    if (document.hidden) {
      saveLive();
    } else {
      keepScreenOn();
      if (!active) {
        ham.say('화면이 꺼진 동안은 못 들었어요. 다시 들을게요', 5000);
        restartTimer = setTimeout(() => {
          try { startRecognizer(); } catch {}
        }, 300);
      }
    }
  });

  function showState(st) {
    $('m-idle').hidden = st !== 'idle';
    $('m-recording').hidden = st !== 'recording';
    $('mode-rec').hidden = st !== 'recording';
  }

  $('m-start').addEventListener('click', () => {
    if (recording || !SpeechRec) return;
    sessions = [];
    current = '';
    fatalError = '';
    meetingId = new Date().toISOString().replace(/[:.]/g, '-');
    startedAt = Date.now();
    recording = true;
    try {
      active = false;
      startRecognizer(); // 아이폰은 버튼을 누른 그 순간에 시작해야 허용된다
    } catch (e) {
      recording = false;
      ham.say('받아 적기를 시작하지 못했어요', 5000);
      return;
    }
    keepScreenOn();
    $('m-result').hidden = true;
    $('m-live').hidden = false;
    renderLive();
    showState('recording');
    ham.listening(true);
    ham.say('귀 쫑긋! 잘 듣고 있을게요', 4000);
    timer = setInterval(() => {
      $('m-timer').textContent = fmtDur((Date.now() - startedAt) / 1000);
      saveLive();
    }, 1000);
  });

  $('m-stop').addEventListener('click', () => stopMeeting(false));

  function stopMeeting(byError) {
    if (!recording) return;
    recording = false;
    clearInterval(timer);
    clearTimeout(restartTimer);
    try { rec && rec.stop(); } catch {}
    commitCurrent();
    try { wakeLock && wakeLock.release(); } catch {}
    wakeLock = null;
    ham.listening(false);
    showState('idle');
    $('m-live').hidden = true;
    const result = finishMeeting({ id: meetingId, startedAt, transcript: transcriptSoFar(), segments: segmentsSoFar(), endedAt: Date.now() });
    store.del(LIVE_KEY);
    renderResult(result);
    loadList();
    if (byError && fatalError) ham.say(fatalError, 8000);
    else if (result.status === 'done') {
      // 할 일 개수만큼 메모를 볼에 냠냠 받아먹고 나서 인사
      const n = result.minutes.action_items.length;
      ham.eat(Math.max(1, n)).then(() => {
        ham.act('hop', 600);
        ham.say(n ? `할 일 ${n}개 냠냠! 회의록을 메모장에 넣어 뒀어요` : '회의록을 메모장에 넣어 뒀어요!', 4500);
      });
    } else ham.say('받아 적은 말이 없어요', 4000);
  }

  // 정리해서 저장하고, 회의록 요약을 메모장(볼주머니)에 한 장 남긴다
  function finishMeeting({ id, startedAt: st, transcript, segments, endedAt }) {
    const durationSec = Math.max(1, Math.round((endedAt - st) / 1000));
    if (!transcript.trim()) {
      // 빈 회의는 목록에 남기지 않고 안내만 한다
      return { id, startedAt: st, durationSec, transcript: '', status: 'error', error: '받아 적은 말이 없어요. 마이크와 받아쓰기 설정을 확인해 주세요.' };
    }
    const minutes = window.BasicMinutes.extractBasicMinutes(transcript, { durationSec });
    const record = { id, startedAt: st, durationSec, transcript, segments: segments || [], status: 'done', minutes };
    record.noteId = ham.addNoteText(toNoteText(record), 'lilac');
    saveMeeting(record);
    return record;
  }

  // 앱이 녹음 중에 꺼졌다면 다음에 열 때 받아 적은 데까지 회의록으로 살린다
  // (메모 목록을 다 불러온 뒤에 넣어야 덮어써지지 않으므로 잠깐 기다린다)
  const leftover = store.get(LIVE_KEY, null);
  store.del(LIVE_KEY);
  if (leftover && leftover.transcript) {
    setTimeout(() => {
      const r = finishMeeting({ ...leftover, endedAt: leftover.savedAt || Date.now() });
      setMode('meeting');
      renderResult(r);
      loadList();
      ham.say('중간에 끊긴 회의를 회의록으로 살려 뒀어요', 5000);
    }, 500);
  }

  // ── 결과 화면 ──
  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  const when = (t) => new Date(t).toLocaleString('ko-KR', { month: 'long', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit' });
  const ymd = (t) => {
    const d = new Date(t);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  // 문장에 이미 들어 있는 담당자·기한은 다시 붙이지 않는다
  const actionText = (a) =>
    `${a.task}${a.owner && !a.task.includes(a.owner) ? ` (${a.owner})` : ''}${a.due && !a.task.includes(a.due) ? ` ~${a.due}` : ''}`;

  // 칸 이름 ↔ 데이터
  const CATS = [
    { key: 'decisions', label: '결정사항', short: '결정' },
    { key: 'action_items', label: '할 일', short: '할 일' },
    { key: 'open_questions', label: '확인 필요', short: '확인' },
    { key: 'key_points', label: '주요 내용', short: '주요' },
    { key: 'others', label: '기타 내용', short: '기타' },
  ];
  const itemText = (key, it) => (key === 'action_items' ? it.task : it);
  function toItem(key, text) {
    if (key !== 'action_items') return text;
    return { task: text, owner: window.BasicMinutes.findOwner(text), due: window.BasicMinutes.findDue(text) };
  }

  function toNoteText(m) {
    const mm = m.minutes;
    const lines = [`[회의] ${mm.title} · ${when(m.startedAt)}`];
    if (mm.decisions.length) lines.push('결정: ' + mm.decisions.join(' / '));
    if (mm.action_items.length) lines.push('할 일: ' + mm.action_items.map(actionText).join(' / '));
    if (mm.open_questions.length) lines.push('확인 필요: ' + mm.open_questions.join(' / '));
    if (lines.length === 1) lines.push((mm.key_points || []).slice(0, 2).join(' / ') || mm.summary);
    return lines.join('\n');
  }

  function toMarkdown(m) {
    const mm = m.minutes;
    const list = (arr) => (arr.length ? arr.map((x) => `- ${x}`).join('\n') : '- 없음');
    return [
      `# ${mm.title}`,
      `${when(m.startedAt)} · ${fmtDur(m.durationSec || 0)}`,
      '',
      mm.summary,
      '',
      '## 결정사항', list(mm.decisions),
      '',
      '## 할 일', list(mm.action_items.map(actionText)),
      '',
      '## 확인 필요', list(mm.open_questions),
      '',
      '## 주요 내용', list(mm.key_points || []),
    ].join('\n');
  }

  // 고친 내용을 저장하고 메모장 요약도 맞춘다
  function commitEdit(m) {
    m.editedAt = Date.now();
    saveMeeting(m);
    if (m.noteId) ham.updateNoteText(m.noteId, toNoteText(m));
    renderResult(m, { keepScroll: true });
    loadList();
  }

  // 문장을 누르면 나오는 "옮기기" 줄
  function moveMenu(m, fromKey, index) {
    const bar = el('div', 'm-move');
    for (const c of CATS) {
      if (c.key === fromKey) continue;
      const b = el('button', 'tiny-btn', c.short);
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        const [it] = m.minutes[fromKey].splice(index, 1);
        (m.minutes[c.key] = m.minutes[c.key] || []).push(toItem(c.key, itemText(fromKey, it)));
        ham.say(`${c.label}(으)로 옮겼어요`);
        commitEdit(m);
      });
      bar.appendChild(b);
    }
    const del = el('button', 'tiny-btn danger', '빼기');
    del.addEventListener('click', (e) => {
      e.stopPropagation();
      m.minutes[fromKey].splice(index, 1);
      commitEdit(m);
    });
    bar.appendChild(del);
    return bar;
  }

  function section(m, cat, { collapsed = false } = {}) {
    const items = m.minutes[cat.key] || [];
    const s = el(collapsed ? 'details' : 'div', 'm-sec');
    const title = el(collapsed ? 'summary' : 'div', 'm-sec-title', `${cat.label} ${items.length}`);
    s.appendChild(title);
    if (!items.length) {
      s.appendChild(el('div', 'm-empty', '없음'));
      return s;
    }
    const ul = el('ul');
    items.forEach((it, i) => {
      const li = el('li', cat.key === 'action_items' ? 'm-action m-item-edit' : 'm-item-edit');
      const body = el('div', 'm-action-body');
      body.appendChild(el('span', null, itemText(cat.key, it)));
      if (cat.key === 'action_items') {
        if (it.owner) body.appendChild(el('span', 'chip', it.owner));
        if (it.due) body.appendChild(el('span', 'chip due', it.due));
      }
      li.appendChild(body);
      if (cat.key === 'action_items') {
        const add = el('button', 'tiny-btn', '메모로');
        add.title = '할 일 하나를 따로 메모로 넣기';
        add.addEventListener('click', (e) => {
          e.stopPropagation();
          ham.eat(1);
          ham.addNoteText(actionText(it));
          add.textContent = '넣음';
          add.disabled = true;
          ham.say('할 일을 볼주머니에 쏙!');
        });
        li.appendChild(add);
      }
      // 누르면 옮기기 줄을 열고 닫는다
      li.addEventListener('click', () => {
        const open = li.nextElementSibling && li.nextElementSibling.classList.contains('m-move');
        ul.querySelectorAll('.m-move').forEach((x) => x.remove());
        if (!open) li.after(moveMenu(m, cat.key, i));
      });
      ul.appendChild(li);
    });
    s.appendChild(ul);
    return s;
  }

  // ── AI 앱(제미나이 등)으로 정리 맡기기 ──
  function aiPrompt(m) {
    return [
      '아래는 회의를 핸드폰 음성 인식으로 받아 적은 글이야. 오타나 잘못 들린 말, 문장부호 없음이 섞여 있어.',
      '내용을 이해해서 회의록으로 정리해 줘. 말하지 않은 내용은 지어내지 말고, 담당·기한은 회의에서 말한 경우에만 적어.',
      '답은 다른 설명 없이 꼭 아래 형식 그대로 써 줘. (표를 그대로 복사해서 앱에 붙여 넣을 거야)',
      '',
      '제목: (20자 이내)',
      '요약: (2~3문장)',
      '| 구분 | 내용 | 담당 | 기한 |',
      '|---|---|---|---|',
      '| 결정 | (정해진 것) | | |',
      '| 할 일 | (해야 할 일) | (사람) | (기한) |',
      '| 확인 필요 | (결론이 안 났거나 확인할 것) | | |',
      '| 주요 내용 | (중요한 논의) | | |',
      '',
      `[회의 정보] ${when(m.startedAt)}, 약 ${Math.max(1, Math.round((m.durationSec || 0) / 60))}분`,
      '[받아 적은 글]',
      m.transcript,
    ].join('\n');
  }

  // AI 답(표 또는 탭으로 나뉜 줄)을 읽어 회의록으로 바꾼다
  function parseAiAnswer(text) {
    const out = { method: 'ai', title: '', summary: '', decisions: [], action_items: [], open_questions: [], key_points: [], others: [] };
    const norm = (s) => s.replace(/\*\*/g, '').trim();
    const pick = (cat) => {
      const c = cat.replace(/\s/g, '');
      if (/결정/.test(c)) return 'decisions';
      if (/할일|할것|액션|조치|담당업무|todo/i.test(c)) return 'action_items';
      if (/확인|질문|미정|보류|이슈/.test(c)) return 'open_questions';
      if (/주요|논의|내용|요점|참고/.test(c)) return 'key_points';
      return null;
    };
    for (const raw of String(text || '').split(/\r?\n/)) {
      const line = norm(raw);
      if (!line) continue;
      const t = line.match(/^#*\s*제목\s*[:：]\s*(.+)$/);
      if (t) { out.title = t[1].trim(); continue; }
      const s = line.match(/^#*\s*요약\s*[:：]\s*(.+)$/);
      if (s) { out.summary = s[1].trim(); continue; }
      let cells = null;
      if (line.includes('|')) cells = line.replace(/^\|/, '').replace(/\|$/, '').split('|').map((x) => norm(x));
      else if (line.includes('\t')) cells = line.split('\t').map((x) => norm(x));
      if (!cells || cells.length < 2) continue;
      if (/^:?-{2,}:?$/.test(cells[0]) || cells[0] === '구분') continue; // 구분선·머리줄
      const key = pick(cells[0]);
      const body = cells[1];
      if (!key || !body || body === '-' || /^\(.*\)$/.test(body)) continue;
      const blank = (v) => (!v || v === '-' || v === '없음' || /^\(.*\)$/.test(v) ? null : v);
      if (key === 'action_items') out.action_items.push({ task: body, owner: blank(cells[2]), due: blank(cells[3]) });
      else out[key].push(body);
    }
    const n = out.decisions.length + out.action_items.length + out.open_questions.length + out.key_points.length;
    return n ? out : null;
  }

  function aiBox(m) {
    const box = el('details', 'm-ai');
    box.appendChild(el('summary', null, 'AI 앱(제미나이 등)으로 더 똑똑하게 정리'));
    box.appendChild(el('p', 'm-hint',
      '① 보내기를 눌러 제미나이·Claude·ChatGPT 앱에 붙여 넣고 → ② AI가 만든 답을 전부 복사해서 → ③ 아래 칸에 붙여 넣으세요. 회사 회의는 회사 계정 AI 앱을 쓰세요.'));
    const row = el('div', 'm-row');
    const send = el('button', 'small-btn', navigator.share ? '① AI 앱으로 보내기' : '① 요청 복사');
    send.addEventListener('click', async () => {
      const text = aiPrompt(m);
      try {
        if (navigator.share) await navigator.share({ text });
        else {
          await navigator.clipboard.writeText(text);
          send.textContent = '복사됨 · AI 앱에 붙여 넣으세요';
        }
      } catch {}
    });
    const copy = el('button', 'small-btn', '복사만');
    copy.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(aiPrompt(m));
        copy.textContent = '복사됨';
        setTimeout(() => (copy.textContent = '복사만'), 1500);
      } catch {
        ham.say('복사가 안 돼요. 보내기를 써 주세요', 4000);
      }
    });
    row.append(send);
    if (navigator.share) row.append(copy);
    box.appendChild(row);
    const ta = el('textarea', 'm-paste');
    ta.rows = 5;
    ta.placeholder = '③ AI가 만든 답(제목·요약·표)을 여기에 붙여 넣기';
    box.appendChild(ta);
    const apply = el('button', 'add-btn', '정리 결과 적용');
    apply.addEventListener('click', () => {
      const parsed = parseAiAnswer(ta.value);
      if (!parsed) {
        ham.say('표를 찾지 못했어요. AI 답을 통째로 붙여 넣어 주세요', 5000);
        return;
      }
      m.basicMinutes = m.basicMinutes || (m.minutes.method === 'basic' ? m.minutes : null);
      parsed.title = parsed.title || m.minutes.title;
      parsed.summary = parsed.summary || 'AI 앱으로 정리한 회의록이에요.';
      m.minutes = parsed;
      ham.act('hop', 600);
      ham.say('AI 정리를 회의록과 메모장에 반영했어요!', 4000);
      commitEdit(m);
    });
    box.appendChild(apply);
    if (m.basicMinutes && m.minutes.method === 'ai') {
      const undo = el('button', 'small-btn', '자동 골라내기로 되돌리기');
      undo.addEventListener('click', () => {
        m.minutes = m.basicMinutes;
        commitEdit(m);
      });
      box.appendChild(undo);
    }
    return box;
  }

  // ── 엑셀 ──
  function fileSafe(s) {
    return String(s || '회의록').replace(/[\\/:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40);
  }
  function downloadExcel(m) {
    const mm = m.minutes;
    const H = (v) => ({ v, style: 'head' });
    const L = (v) => ({ v, style: 'label' });
    const rows = [
      [{ v: mm.title, style: 'title' }],
      [L('일시'), when(m.startedAt)],
      [L('길이'), fmtDur(m.durationSec || 0)],
      [L('정리 방식'), mm.method === 'ai' ? 'AI 앱 정리' : '자동 골라내기 (말투 규칙)'],
      [L('요약'), mm.summary],
      [],
      [H('구분'), H('내용'), H('담당'), H('기한'), H('완료')],
    ];
    const header = rows.length;
    for (const d of mm.decisions) rows.push(['결정', d, '', '', '']);
    for (const a of mm.action_items) rows.push(['할 일', a.task, a.owner || '', a.due || '', '']);
    for (const q of mm.open_questions) rows.push(['확인 필요', q, '', '', '']);
    for (const k of mm.key_points || []) rows.push(['주요 내용', k, '', '', '']);
    for (const o of mm.others || []) rows.push(['기타', o, '', '', '']);

    const segs = (m.segments && m.segments.length ? m.segments : m.transcript.split('\n').map((text) => ({ t: null, text }))).filter((s) => s.text);
    const rawRows = [[H('시각'), H('받아 적은 내용')], ...segs.map((s) => [s.t == null ? '' : fmtDur(s.t), s.text])];

    const bytes = window.XlsxLite.build([
      { name: '회의록', rows, widths: [12, 64, 16, 14, 8], freezeRow: header },
      { name: '원문', rows: rawRows, widths: [10, 90], freezeRow: 1 },
    ]);
    const name = `회의록_${ymd(m.startedAt)}_${fileSafe(mm.title)}.xlsx`;
    const blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    // 핸드폰은 공유 창(파일 앱에 저장, 카카오톡, 메일)으로, 안 되면 바로 내려받기
    const file = typeof File !== 'undefined' ? new File([blob], name, { type: blob.type }) : null;
    if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
      navigator.share({ files: [file], title: name }).catch(() => {});
      return;
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  }

  function renderResult(m, { keepScroll = false } = {}) {
    const view = $('view-meeting');
    const y = view.scrollTop;
    const box = $('m-result');
    box.innerHTML = '';
    if (!m) { box.hidden = true; return; }
    box.hidden = false;
    const card = el('div', 'm-card');
    box.appendChild(card);

    if (m.status !== 'done' || !m.minutes) {
      card.appendChild(el('div', 'm-title', '정리하지 못한 회의'));
      card.appendChild(el('div', 'm-meta', `${when(m.startedAt)} · ${fmtDur(m.durationSec || 0)}`));
      card.appendChild(el('p', 'm-error', m.error || '받아 적은 말이 없어요.'));
      return;
    }
    const mm = m.minutes;
    card.appendChild(el('div', 'm-title', mm.title));
    const meta = el('div', 'm-meta', `${when(m.startedAt)} · ${fmtDur(m.durationSec || 0)} `);
    meta.appendChild(el('span', mm.method === 'ai' ? 'badge ai' : 'badge basic', mm.method === 'ai' ? 'AI 정리' : '자동 골라내기'));
    card.appendChild(meta);
    card.appendChild(el('p', 'm-summary', mm.summary));

    const row = el('div', 'm-actions-row');
    const xlsx = el('button', 'add-btn', '엑셀로 저장');
    xlsx.addEventListener('click', () => downloadExcel(m));
    const share = el('button', 'small-btn', navigator.share ? '글로 공유' : '복사');
    share.addEventListener('click', async () => {
      const text = toMarkdown(m);
      try {
        if (navigator.share) await navigator.share({ title: mm.title, text });
        else {
          await navigator.clipboard.writeText(text);
          share.textContent = '복사됨';
          setTimeout(() => (share.textContent = '복사'), 1500);
        }
      } catch {}
    });
    row.append(xlsx, share);
    card.appendChild(row);

    card.appendChild(el('p', 'm-hint', '문장을 누르면 다른 칸으로 옮기거나 뺄 수 있어요. 고친 내용은 메모장 요약에도 반영돼요.'));
    for (const cat of CATS.slice(0, 4)) card.appendChild(section(m, cat));
    card.appendChild(section(m, CATS[4], { collapsed: true }));

    card.appendChild(aiBox(m));

    if (m.transcript) {
      const det = el('details', 'm-raw');
      det.appendChild(el('summary', null, '받아 적은 원문 보기'));
      det.appendChild(el('div', 'm-raw-text', m.transcript));
      card.appendChild(det);
    }
    if (keepScroll) view.scrollTop = y;
  }

  // ── 지난 회의 ──
  function loadList() {
    const items = loadMeetings();
    const box = $('m-list');
    box.innerHTML = '';
    if (!items.length) {
      box.appendChild(el('div', 'm-empty', '아직 회의록이 없어요'));
      return;
    }
    for (const it of items) {
      const row = el('div', 'm-item');
      const open = el('button', 'm-item-open');
      open.appendChild(el('span', 'm-item-title', it.minutes ? it.minutes.title : '정리 못 한 회의'));
      open.appendChild(el('span', 'm-item-meta', `${when(it.startedAt)} · ${fmtDur(it.durationSec || 0)}`));
      open.addEventListener('click', () => {
        renderResult(it);
        $('m-result').scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
      const del = el('button', 'del');
      del.title = '회의록 지우기';
      del.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>';
      del.addEventListener('click', () => {
        if (!confirm(`"${it.minutes ? it.minutes.title : '이 회의'}" 회의록을 지울까요? 되돌릴 수 없어요.`)) return;
        store.set(MEETINGS_KEY, loadMeetings().filter((m) => m.id !== it.id));
        $('m-result').hidden = true;
        loadList();
      });
      row.append(open, del);
      box.appendChild(row);
    }
  }

  // ── 백업 ──
  $('b-export').addEventListener('click', () => {
    const data = { app: 'hamster-note', version: 1, exportedAt: new Date().toISOString(), notes: store.get('hamster-note', { notes: [] }), meetings: loadMeetings() };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `햄스터노트-백업-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  });
  $('b-import').addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (data.app !== 'hamster-note' || !Array.isArray(data.meetings) || !data.notes) throw new Error();
      if (!confirm(`백업을 합칠까요? (메모 ${data.notes.notes?.length || 0}개, 회의록 ${data.meetings.length}개) 같은 항목은 백업 쪽으로 바뀌어요.`)) return;
      const cur = store.get('hamster-note', { notes: [], settings: {} });
      const byId = new Map((cur.notes || []).map((n) => [n.id, n]));
      for (const n of data.notes.notes || []) byId.set(n.id, n);
      store.set('hamster-note', { ...cur, notes: [...byId.values()].sort((a, b) => b.createdAt - a.createdAt) });
      const mById = new Map(loadMeetings().map((m) => [m.id, m]));
      for (const m of data.meetings) mById.set(m.id, m);
      store.set(MEETINGS_KEY, [...mById.values()].sort((a, b) => b.startedAt - a.startedAt));
      location.reload();
    } catch {
      ham.say('햄스터 노트 백업 파일이 아니에요', 4000);
    }
  });

  showState('idle');
  loadList();
})();

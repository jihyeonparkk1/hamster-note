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

  function transcriptSoFar() {
    return [...sessions, current].map((s) => s.trim()).filter(Boolean).join('\n');
  }

  function saveLive() {
    if (!recording) return;
    store.set(LIVE_KEY, { id: meetingId, startedAt, transcript: transcriptSoFar(), savedAt: Date.now() });
  }

  function renderLive() {
    const box = $('m-live-text');
    box.innerHTML = '';
    for (const s of sessions) if (s.trim()) box.appendChild(el('p', null, s.trim()));
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
    if (current.trim()) sessions.push(current.trim());
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
      current = joinResults(e.results);
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
    const result = finishMeeting({ id: meetingId, startedAt, transcript: transcriptSoFar(), endedAt: Date.now() });
    store.del(LIVE_KEY);
    renderResult(result);
    loadList();
    if (byError && fatalError) ham.say(fatalError, 8000);
    else if (result.status === 'done') {
      ham.act('hop', 600);
      ham.say('회의록을 메모장에도 넣어 뒀어요!', 4000);
    } else ham.say('받아 적은 말이 없어요', 4000);
  }

  // 정리해서 저장하고, 회의록 요약을 메모장(볼주머니)에 한 장 남긴다
  function finishMeeting({ id, startedAt: st, transcript, endedAt }) {
    const durationSec = Math.max(1, Math.round((endedAt - st) / 1000));
    if (!transcript.trim()) {
      // 빈 회의는 목록에 남기지 않고 안내만 한다
      return { id, startedAt: st, durationSec, transcript: '', status: 'error', error: '받아 적은 말이 없어요. 마이크와 받아쓰기 설정을 확인해 주세요.' };
    }
    const minutes = window.BasicMinutes.extractBasicMinutes(transcript, { durationSec });
    const record = { id, startedAt: st, durationSec, transcript, status: 'done', minutes };
    saveMeeting(record);
    ham.addNoteText(toNoteText(record), 'lilac');
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

  // ── 결과 ──
  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  const when = (t) => new Date(t).toLocaleString('ko-KR', { month: 'long', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit' });
  // 문장에 이미 들어 있는 담당자·기한은 다시 붙이지 않는다
  const actionText = (a) =>
    `${a.task}${a.owner && !a.task.includes(a.owner) ? ` (${a.owner})` : ''}${a.due && !a.task.includes(a.due) ? ` ~${a.due}` : ''}`;

  function toNoteText(m) {
    const mm = m.minutes;
    const lines = [`[회의] ${mm.title} · ${when(m.startedAt)}`];
    if (mm.decisions.length) lines.push('결정: ' + mm.decisions.join(' / '));
    if (mm.action_items.length) lines.push('할 일: ' + mm.action_items.map(actionText).join(' / '));
    if (mm.open_questions.length) lines.push('확인 필요: ' + mm.open_questions.join(' / '));
    if (lines.length === 1) lines.push(mm.key_points.slice(0, 2).join(' / ') || mm.summary);
    return lines.join('\n');
  }

  function toMarkdown(m) {
    const mm = m.minutes;
    const list = (arr) => (arr.length ? arr.map((x) => `- ${x}`).join('\n') : '- 없음');
    return [
      `# ${mm.title}`,
      `${when(m.startedAt)} · ${fmtDur(m.durationSec || 0)}`,
      '',
      '## 결정사항', list(mm.decisions),
      '',
      '## 할 일', list(mm.action_items.map(actionText)),
      '',
      '## 확인 필요', list(mm.open_questions),
      '',
      '## 주요 내용', list(mm.key_points),
    ].join('\n');
  }

  function section(title, items, render) {
    const s = el('div', 'm-sec');
    s.appendChild(el('div', 'm-sec-title', `${title} ${items.length}`));
    if (!items.length) {
      s.appendChild(el('div', 'm-empty', '없음'));
      return s;
    }
    const ul = el('ul');
    for (const it of items) ul.appendChild(render(it));
    s.appendChild(ul);
    return s;
  }

  function renderResult(m) {
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
    meta.appendChild(el('span', 'badge basic', '자동 골라내기'));
    card.appendChild(meta);
    card.appendChild(el('p', 'm-summary', mm.summary));

    card.appendChild(section('결정사항', mm.decisions, (d) => el('li', null, d)));
    const acts = section('할 일', mm.action_items, (a) => {
      const li = el('li', 'm-action');
      const body = el('div', 'm-action-body');
      body.appendChild(el('span', null, a.task));
      if (a.owner) body.appendChild(el('span', 'chip', a.owner));
      if (a.due) body.appendChild(el('span', 'chip due', a.due));
      const add = el('button', 'tiny-btn', '메모로');
      add.title = '할 일 하나를 따로 메모로 넣기';
      add.addEventListener('click', () => {
        ham.addNoteText(actionText(a));
        add.textContent = '넣음';
        add.disabled = true;
        ham.say('할 일을 볼주머니에 쏙!');
      });
      li.append(body, add);
      return li;
    });
    card.appendChild(acts);
    card.appendChild(section('확인 필요', mm.open_questions, (d) => el('li', null, d)));
    card.appendChild(section('주요 내용', mm.key_points, (d) => el('li', null, d)));

    const row = el('div', 'm-actions-row');
    const share = el('button', 'small-btn', navigator.share ? '공유' : '복사');
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
    row.appendChild(share);
    card.appendChild(row);

    if (m.transcript) {
      const det = el('details', 'm-raw');
      det.appendChild(el('summary', null, '받아 적은 원문 보기'));
      det.appendChild(el('div', 'm-raw-text', m.transcript));
      card.appendChild(det);
    }
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

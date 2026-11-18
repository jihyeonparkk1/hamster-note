// 햄스터 노트 — 화면 로직
// Electron 안에서는 window.api(파일 저장)를, 브라우저 미리보기에서는 localStorage를 쓴다.
(() => {
  'use strict';

  const COLORS = [
    { id: 'butter', bg: '#fff1b8' },
    { id: 'peach', bg: '#ffd9c4' },
    { id: 'mint', bg: '#d3f2df' },
    { id: 'sky', bg: '#d6e9ff' },
    { id: 'lilac', bg: '#eadcff' },
  ];

  const LINES = {
    morning: ['좋은 아침이에요!', '아침 해바라기씨 먹었어요?', '오늘 할 일 알려 주세요!'],
    day: ['오늘도 화이팅!', '메모는 콩이가 지켜 줄게요', '잠깐 쳇바퀴 돌고 올게요~'],
    evening: ['오늘 하루 수고했어요', '저녁엔 쉬엄쉬엄 해요', '내일 할 일도 넣어 둘까요?'],
    night: ['늦었어요, 얼른 자요…', '콩이는 야행성이라 괜찮아요', '쿨쿨… 아, 안 잤어요!'],
    pet: ['헤헤, 간지러워요', '더 쓰다듬어 주세요!', '찍찍!', '볼주머니 만지지 마세요~', '해바라기씨 주세요!'],
    add: ['볼주머니에 쏙!', '냠, 잘 넣어 뒀어요', '꼭꼭 숨겨 둘게요', '잊지 않게 챙겨 둘게요'],
    done: ['다 했다! 최고예요', '하나 끝! 잘했어요', '해치웠다!'],
    allDone: ['할 일을 전부 끝냈어요! 대단해요'],
    remove: ['퉤! 꺼냈어요', '볼주머니에서 뺐어요'],
    restore: ['다시 넣어 뒀어요!'],
    empty: ['볼주머니가 텅 비었어요'],
  };

  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

  // ── 저장소 ──
  const storage = window.api
    ? { load: () => window.api.loadNotes(), save: (d) => window.api.saveNotes(d) }
    : {
        load: async () => {
          try { return JSON.parse(localStorage.getItem('hamster-note') || 'null') || { notes: [], settings: {} }; }
          catch { return { notes: [], settings: {} }; }
        },
        save: async (d) => { try { localStorage.setItem('hamster-note', JSON.stringify(d)); } catch {} },
      };

  const state = { notes: [], settings: { filter: 'all', color: 'butter' }, query: '' };
  let saveTimer;
  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => storage.save({ notes: state.notes, settings: state.settings }), 250);
  }

  // ── 요소 ──
  const $ = (id) => document.getElementById(id);
  const input = $('input');
  const list = $('list');
  const bubble = $('bubble');
  const hamsterBtn = $('hamster');
  const hamster = hamsterBtn.querySelector('svg');
  const pouchCount = $('pouch-count');
  const colorsEl = $('colors');
  const search = $('search');
  const toast = $('toast');

  // ── 햄스터 반응 ──
  let bubbleTimer;
  function say(text, ms = 3200) {
    bubble.textContent = text;
    bubble.classList.remove('hidden');
    clearTimeout(bubbleTimer);
    bubbleTimer = setTimeout(() => bubble.classList.add('hidden'), ms);
  }
  function act(cls, ms = 700) {
    hamster.classList.remove(cls);
    void hamster.getBoundingClientRect(); // 같은 애니메이션을 연달아 다시 재생
    hamster.classList.add(cls);
    setTimeout(() => hamster.classList.remove(cls), ms);
  }
  function timeOfDay() {
    const h = new Date().getHours();
    if (h >= 5 && h < 11) return 'morning';
    if (h >= 11 && h < 18) return 'day';
    if (h >= 18 && h < 23) return 'evening';
    return 'night';
  }
  // 할 일이 많을수록 볼이 통통해진다 (최대 10개까지)
  function updateCheeks() {
    const open = state.notes.filter((n) => !n.done).length;
    // 할 일 하나마다 볼이 눈에 띄게 커지고(최대 12개, 약 1.7배), 끝내면 다시 줄어든다
    hamster.style.setProperty('--cheek-scale', String(1 + Math.min(open, 12) * 0.06));
    pouchCount.textContent = `볼주머니 ${state.notes.length}개 · 할 일 ${open}개`;
  }

  // ── 색 고르기 ──
  function renderColors() {
    colorsEl.innerHTML = '';
    for (const c of COLORS) {
      const b = document.createElement('button');
      b.className = 'color-dot';
      b.style.background = c.bg;
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-label', c.id);
      b.setAttribute('aria-checked', String(state.settings.color === c.id));
      b.addEventListener('click', () => {
        state.settings.color = c.id;
        renderColors();
        scheduleSave();
        input.focus();
      });
      colorsEl.appendChild(b);
    }
  }

  // ── 목록 ──
  const fmt = (t) => {
    const d = new Date(t);
    const today = new Date();
    const same = d.toDateString() === today.toDateString();
    const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    return same ? `오늘 ${hm}` : `${d.getMonth() + 1}월 ${d.getDate()}일 ${hm}`;
  };

  function visibleNotes() {
    const q = state.query.trim().toLowerCase();
    return state.notes.filter((n) => {
      if (state.settings.filter === 'todo' && n.done) return false;
      if (state.settings.filter === 'done' && !n.done) return false;
      if (q && !n.text.toLowerCase().includes(q)) return false;
      return true;
    });
  }

  function renderTabs() {
    const counts = {
      all: state.notes.length,
      todo: state.notes.filter((n) => !n.done).length,
      done: state.notes.filter((n) => n.done).length,
    };
    const names = { all: '전체', todo: '할 일', done: '완료' };
    document.querySelectorAll('.tab').forEach((t) => {
      const f = t.dataset.filter;
      t.setAttribute('aria-selected', String(state.settings.filter === f));
      t.innerHTML = `${names[f]}<span class="n">${counts[f]}</span>`;
    });
  }

  function render() {
    renderTabs();
    updateCheeks();
    const items = visibleNotes();
    list.innerHTML = '';
    if (!items.length) {
      const e = document.createElement('div');
      e.className = 'empty';
      e.textContent = state.query
        ? '찾는 메모가 볼주머니에 없어요'
        : state.settings.filter === 'done'
          ? '아직 끝낸 일이 없어요'
          : '볼주머니가 비었어요.\n위에 메모를 써서 넣어 주세요!';
      e.style.whiteSpace = 'pre-line';
      list.appendChild(e);
      return;
    }
    for (const n of items) list.appendChild(noteEl(n));
  }

  function noteEl(n) {
    const color = COLORS.find((c) => c.id === n.color) || COLORS[0];
    const el = document.createElement('article');
    el.className = 'note' + (n.done ? ' done' : '');
    el.style.setProperty('--note-bg', color.bg);

    const check = document.createElement('button');
    check.className = 'check';
    check.title = n.done ? '다시 할 일로' : '완료';
    check.innerHTML = '<svg viewBox="0 0 24 24" width="12" height="12"><path d="M5 12l5 5 9-10" stroke="#fff" stroke-width="3.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    check.addEventListener('click', () => toggleDone(n.id));

    const body = document.createElement('div');
    body.className = 'note-body';
    const text = document.createElement('div');
    text.className = 'note-text';
    text.textContent = n.text;
    text.title = '두 번 눌러서 고치기';
    text.addEventListener('dblclick', () => startEdit(text, n.id));
    const meta = document.createElement('div');
    meta.className = 'note-meta';
    meta.textContent = fmt(n.createdAt) + (n.editedAt ? ' · 고침' : '');
    body.append(text, meta);

    const del = document.createElement('button');
    del.className = 'del';
    del.title = '꺼내기(삭제)';
    del.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>';
    del.addEventListener('click', () => removeNote(n.id));

    el.append(check, body, del);
    return el;
  }

  // ── 동작 ──
  function addNote() {
    const text = input.value.trim();
    if (!text) {
      say('뭘 넣을까요?');
      act('wiggle', 500);
      return;
    }
    state.notes.unshift({
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      text,
      color: state.settings.color,
      done: false,
      createdAt: Date.now(),
    });
    input.value = '';
    if (state.settings.filter === 'done') state.settings.filter = 'all';
    render();
    scheduleSave();
    act('puff', 900);
    say(pick(LINES.add));
  }

  function toggleDone(id) {
    const n = state.notes.find((x) => x.id === id);
    if (!n) return;
    n.done = !n.done;
    render();
    scheduleSave();
    if (n.done) {
      act('hop', 600);
      act('happy', 900);
      const left = state.notes.filter((x) => !x.done).length;
      say(left === 0 ? pick(LINES.allDone) : pick(LINES.done));
    }
  }

  let lastRemoved = null;
  let toastTimer;
  function removeNote(id) {
    const idx = state.notes.findIndex((x) => x.id === id);
    if (idx < 0) return;
    lastRemoved = { note: state.notes[idx], idx };
    state.notes.splice(idx, 1);
    render();
    scheduleSave();
    act('wiggle', 500);
    say(state.notes.length ? pick(LINES.remove) : pick(LINES.empty));
    $('toast-text').textContent = '메모를 지웠어요';
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.hidden = true; lastRemoved = null; }, 5000);
  }

  function undoRemove() {
    if (!lastRemoved) return;
    state.notes.splice(Math.min(lastRemoved.idx, state.notes.length), 0, lastRemoved.note);
    lastRemoved = null;
    toast.hidden = true;
    render();
    scheduleSave();
    act('puff', 900);
    say(pick(LINES.restore));
  }

  function startEdit(textEl, id) {
    const n = state.notes.find((x) => x.id === id);
    if (!n) return;
    textEl.contentEditable = 'true';
    textEl.focus();
    const range = document.createRange();
    range.selectNodeContents(textEl);
    range.collapse(false);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);

    const finish = (save) => {
      textEl.removeEventListener('blur', onBlur);
      textEl.removeEventListener('keydown', onKey);
      textEl.contentEditable = 'false';
      const next = textEl.innerText.trim();
      if (save && next && next !== n.text) {
        n.text = next;
        n.editedAt = Date.now();
        scheduleSave();
        say('고쳐 뒀어요!');
      }
      render();
    };
    const onBlur = () => finish(true);
    const onKey = (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); textEl.blur(); }
      if (e.key === 'Escape') { textEl.removeEventListener('blur', onBlur); finish(false); }
    };
    textEl.addEventListener('blur', onBlur);
    textEl.addEventListener('keydown', onKey);
  }

  // ── 이벤트 ──
  input.addEventListener('keydown', (e) => {
    // 한글 조합 중 Enter는 글자 확정용이라 넘긴다
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      addNote();
    }
  });
  input.addEventListener('focus', () => hamster.classList.add('peek'));
  input.addEventListener('blur', () => hamster.classList.remove('peek'));
  $('btn-add').addEventListener('click', addNote);
  $('toast-undo').addEventListener('click', undoRemove);

  hamsterBtn.addEventListener('click', () => {
    act('hop', 600);
    say(pick(LINES.pet));
  });

  document.querySelectorAll('.tab').forEach((t) =>
    t.addEventListener('click', () => {
      state.settings.filter = t.dataset.filter;
      render();
      scheduleSave();
    }),
  );
  search.addEventListener('input', () => {
    state.query = search.value;
    render();
  });

  // 창 버튼 (브라우저 미리보기에서는 숨김)
  const pinBtn = $('btn-pin');
  if (window.api) {
    window.api.isPinned().then((p) => pinBtn.classList.toggle('active', p));
    pinBtn.addEventListener('click', async () => {
      const p = await window.api.togglePin();
      pinBtn.classList.toggle('active', p);
      say(p ? '맨 위에 붙어 있을게요!' : '고정 풀었어요');
    });
    $('btn-min').addEventListener('click', () => window.api.minimize());
    $('btn-close').addEventListener('click', async () => {
      clearTimeout(saveTimer);
      await storage.save({ notes: state.notes, settings: state.settings });
      window.api.close();
    });
  } else {
    document.querySelector('.win-buttons').style.visibility = 'hidden';
  }

  // 가끔 혼잣말 (메모 쓰는 중엔 조용히)
  setInterval(() => {
    if (document.activeElement === input || document.hidden) return;
    if (Math.random() < 0.5) say(pick(LINES[timeOfDay()]));
  }, 90_000);

  // 회의록 화면에서 쓰는 햄스터·메모 기능
  window.hamster = {
    say,
    act,
    listening: (on) => hamster.classList.toggle('listening', !!on),
    addNoteText(text, color = 'peach') {
      text = String(text || '').trim();
      if (!text) return null;
      const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      state.notes.unshift({ id, text, color, done: false, createdAt: Date.now() });
      render();
      scheduleSave();
      act('puff', 900);
      return id;
    },
    // 회의록을 고치면 메모장에 넣어 둔 요약도 같이 바뀐다 (메모를 지웠으면 다시 만들지 않음)
    updateNoteText(id, text) {
      const n = state.notes.find((x) => x.id === id);
      if (!n) return false;
      n.text = String(text || '').trim() || n.text;
      n.editedAt = Date.now();
      render();
      scheduleSave();
      return true;
    },
  };

  // ── 시작 ──
  storage.load().then((data) => {
    state.notes = Array.isArray(data?.notes) ? data.notes : [];
    state.settings = { filter: 'all', color: 'butter', ...(data?.settings || {}) };
    renderColors();
    render();
    const open = state.notes.filter((n) => !n.done).length;
    say(open ? `할 일이 ${open}개 있어요!` : pick(LINES[timeOfDay()]));
  });
})();

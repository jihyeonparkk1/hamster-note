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
    petHappy: ['헤헤 기분 최고예요!', '더 더 쓰다듬어 주세요~', '행복해서 녹을 것 같아요'],
    wake: ['화들짝! 안 잤어요… 정말이에요!', '으앗, 깜짝이야! 깨어 있었어요!', '쿨… 아, 네! 듣고 있었어요!'],
    full: ['볼이 꽉 찼어요… 하나만 끝내 주세요 🥺', '더는 못 넣어요… 볼이 터질 것 같아요!', '우물우물… 너무 많아요 🥺'],
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
    bubble.classList.toggle('long', text.length > 22); // 긴 말은 줄바꿈해서 다 보이게
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
  // ── 귀여운 움직임 (씨앗·하트·메모가 날아다님) ──
  const hero = document.querySelector('.hero');
  const reduceMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const SEED_SVG = '<svg width="11" height="16" viewBox="0 0 14 22"><ellipse cx="7" cy="11" rx="6.5" ry="10.5" fill="#5e4636"/><path d="M7 2 L7 20" stroke="#d9cbbd" stroke-width="1.6" stroke-dasharray="3 2.5"/></svg>';
  const PAPER_SVG = '<svg width="16" height="19" viewBox="0 0 22 26"><rect x="1" y="1" width="20" height="24" rx="2" fill="#fff" stroke="#d9c7b2"/><path d="M5 8 L17 8 M5 13 L17 13 M5 18 L13 18" stroke="#c9b49e" stroke-width="1.8" stroke-linecap="round"/></svg>';
  const rand = (a, b) => a + Math.random() * (b - a);
  function pointOf(el, fx = 0.5, fy = 0.5) {
    const h = hero.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    return { x: r.left - h.left + r.width * fx, y: r.top - h.top + r.height * fy };
  }
  function fly(html, cls, from, to, { duration = 700, rotate = 0, delay = 0, arc = 0, scaleTo = 1, fade = true } = {}) {
    if (reduceMotion || !hero) return Promise.resolve();
    const el = document.createElement('div');
    el.className = `fx ${cls}`;
    el.innerHTML = html;
    hero.appendChild(el);
    const mid = { x: (from.x + to.x) / 2, y: Math.min(from.y, to.y) - arc };
    const anim = el.animate(
      [
        { transform: `translate(${from.x}px, ${from.y}px) rotate(0deg)`, opacity: 1 },
        { transform: `translate(${mid.x}px, ${mid.y}px) rotate(${rotate / 2}deg)`, opacity: 1, offset: 0.5 },
        { transform: `translate(${to.x}px, ${to.y}px) rotate(${rotate}deg) scale(${scaleTo})`, opacity: fade ? 0 : 1 },
      ],
      { duration, delay, easing: 'cubic-bezier(.3,.6,.5,1)', fill: 'both' },
    );
    return anim.finished.catch(() => {}).then(() => el.remove());
  }
  // 볼에서 해바라기씨가 톡 튀어나감
  function popSeeds(count = 1) {
    for (let i = 0; i < count; i++) {
      const right = count === 1 ? Math.random() < 0.5 : i % 2 === 0;
      const from = pointOf(hamster.querySelector(right ? '.cheek-r' : '.cheek-l'), right ? 0.75 : 0.25, 0.4);
      const dir = right ? 1 : -1;
      fly(SEED_SVG, 'seed-fx', from, { x: from.x + dir * rand(40, 110), y: from.y + rand(10, 50) }, {
        duration: rand(650, 950), rotate: dir * rand(300, 720), arc: rand(40, 80), delay: count === 1 ? 0 : i * 70,
      });
    }
  }
  function hearts(count = 2) {
    const top = pointOf(hamster, 0.5, 0.2);
    for (let i = 0; i < count; i++) {
      fly('♥', 'heart', { x: top.x + rand(-30, 30), y: top.y }, { x: top.x + rand(-60, 60), y: top.y - rand(40, 80) }, {
        duration: rand(900, 1300), delay: i * 120, rotate: rand(-30, 30),
      });
    }
  }
  // 회의 할 일 등을 볼에 하나씩 냠냠 받아먹기
  async function eat(count) {
    count = Math.min(count, 8);
    const h = hero.getBoundingClientRect();
    for (let i = 0; i < count; i++) {
      const right = i % 2 === 0;
      const to = pointOf(hamster.querySelector(right ? '.cheek-r' : '.cheek-l'), 0.5, 0.45);
      const from = { x: h.width / 2 + rand(-60, 60), y: h.height + 10 };
      await fly(PAPER_SVG, 'paper-fx', from, to, { duration: 420, arc: 30, scaleTo: 0.3, rotate: right ? 40 : -40 });
      act('puff', 900);
      await new Promise((r) => setTimeout(r, 120));
    }
  }
  function runWheel(ms = 4500) {
    if (reduceMotion) return;
    hero.classList.add('running');
    hamster.classList.add('running');
    setTimeout(() => {
      hero.classList.remove('running');
      hamster.classList.remove('running');
    }, ms);
  }

  // ── 해바라기씨 모으기 · 꾸미기 ──
  const OUTFITS = [
    { id: 'ribbon', icon: '🎀', name: '리본', need: 10 },
    { id: 'pin', icon: '🌻', name: '해바라기 핀', need: 30 },
    { id: 'glasses', icon: '👓', name: '안경', need: 50 },
    { id: 'crown', icon: '👑', name: '왕관', need: 100 },
  ];
  const seeds = () => state.settings.seeds || 0;
  function applyOutfit() {
    for (const o of OUTFITS) hamster.classList.remove(`wear-${o.id}`);
    const o = OUTFITS.find((x) => x.id === state.settings.outfit);
    if (o && seeds() >= o.need) hamster.classList.add(`wear-${o.id}`);
    const btn = $('seed-count');
    if (btn) btn.textContent = `🌻 ${seeds()}`;
  }
  function renderCloset() {
    const box = $('closet-items');
    if (!box) return;
    box.innerHTML = '';
    for (const o of [{ id: null, icon: '🐹', name: '없음', need: 0 }, ...OUTFITS]) {
      const b = document.createElement('button');
      b.className = 'closet-item';
      const locked = seeds() < o.need;
      b.disabled = locked;
      b.setAttribute('aria-pressed', String((state.settings.outfit || null) === o.id));
      b.innerHTML = `<span class="ic">${locked ? '🔒' : o.icon}</span><span>${locked ? `씨앗 ${o.need}` : o.name}</span>`;
      b.addEventListener('click', () => {
        state.settings.outfit = o.id;
        applyOutfit();
        renderCloset();
        scheduleSave();
        act('hop', 600);
        say(o.id ? `${o.name} 어때요? 예쁘죠!` : '역시 그냥 콩이가 최고죠');
      });
      box.appendChild(b);
    }
  }
  // 할 일을 처음 끝낼 때만 씨앗 1개 (다시 체크해도 또 받지 않음)
  function awardSeed(note) {
    if (note.seeded) return null;
    note.seeded = true;
    state.settings.seeds = seeds() + 1;
    const btn = $('seed-count');
    if (btn) { btn.classList.remove('bump'); void btn.offsetWidth; btn.classList.add('bump'); }
    applyOutfit();
    return OUTFITS.find((o) => o.need === seeds()) || null; // 방금 열린 꾸미기
  }

  // ── 기한이 오늘인 할 일 (메모 글에서 읽음) ──
  const WEEK = '일월화수목금토';
  const dayStart = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const sameDay = (a, b) => dayStart(a).getTime() === dayStart(b).getTime();
  function dueToday(note) {
    const t = note.text;
    const now = new Date();
    const created = new Date(note.createdAt || Date.now());
    const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
    if (/(^|\s)오늘(\s?(까지|중으로|중에|안에|내로|오전|오후|저녁))?/.test(t) && sameDay(created, now)) return true;
    if (/(^|\s)내일/.test(t) && sameDay(addDays(created, 1), now)) return true;
    const md = t.match(/(\d{1,2})\s?(?:월\s?|\/)\s?(\d{1,2})\s?일?/);
    if (md && +md[1] === now.getMonth() + 1 && +md[2] === now.getDate()) return true;
    const wd = t.match(/(다음\s?주\s?)?([월화수목금토일])요일/);
    if (wd) {
      const target = WEEK.indexOf(wd[2]);
      const m = (d) => (d.getDay() + 6) % 7; // 월요일=0
      let due;
      if (wd[1]) due = addDays(created, -m(created) + 7 + ((target + 6) % 7)); // 다음 주 그 요일
      else due = addDays(created, (target - created.getDay() + 7) % 7); // 이번에 오는 그 요일
      return sameDay(due, now);
    }
    return false;
  }

  // ── 졸린 콩이 (밤 11시~새벽 5시, 누르면 10분 깨어 있음) ──
  let wakeUntil = 0;
  function updateSleep() {
    const h = new Date().getHours();
    const sleepy = (h >= 23 || h < 5) && Date.now() > wakeUntil && !hamster.classList.contains('listening');
    hamster.classList.toggle('sleepy', sleepy);
    hero.classList.toggle('sleepy', sleepy);
  }
  function stayAwake() {
    wakeUntil = Date.now() + 10 * 60 * 1000;
    updateSleep();
  }
  setInterval(updateSleep, 60 * 1000);

  // ── 업무 중 알림 문구 (PC: 점심시간·퇴근 전) ──
  function composeReminder(kind, notes, now = new Date()) {
    const doneToday = notes.filter((n) => n.done && n.doneAt && sameDay(new Date(n.doneAt), now)).length;
    const open = notes.filter((n) => !n.done);
    const urgent = open.filter((n) => dueToday(n));
    const short = (t) => (t.split('\n')[0].length > 24 ? `${t.split('\n')[0].slice(0, 23)}…` : t.split('\n')[0]);
    if (kind === 'lunch') {
      const lines = ['콩이도 해바라기씨 먹으러 갈게요. 맛있게 드세요!', '오전에 수고했어요. 든든하게 드시고 오세요!', '배꼽시계가 울려요~ 점심 먹고 와요!'];
      return {
        title: '🍚 점심시간이에요!',
        body: pick(lines) + (doneToday ? ` 오전에 ${doneToday}개 끝냈어요 🌻` : ''),
        allDone: false,
      };
    }
    let body;
    if (urgent.length) body = `오늘까지인 일이 ${urgent.length}개 남았어요! "${short(urgent[0].text)}"${urgent.length > 1 ? ` 외 ${urgent.length - 1}개` : ''}`;
    else if (!open.length) body = doneToday ? `할 일을 다 끝냈어요! 오늘 ${doneToday}개 해냈어요 🌻 푹 쉬어요` : '남은 할 일이 없어요. 오늘도 수고했어요!';
    else body = doneToday ? `오늘 ${doneToday}개 끝냈어요! 남은 할 일 ${open.length}개는 내일 같이 해요` : `오늘도 수고했어요. 남은 할 일 ${open.length}개는 내일 같이 해요`;
    return { title: '🏠 곧 퇴근 시간이에요', body, allDone: !open.length && doneToday > 0 };
  }

  // 할 일이 많을수록 볼이 통통해진다
  function updateCheeks() {
    const open = state.notes.filter((n) => !n.done).length;
    // 할 일 하나마다 볼이 옆으로 쭈욱 늘어나고(최대 12개, 가로 약 2.2배), 끝내면 다시 줄어든다
    const n = Math.min(open, 12);
    hamster.style.setProperty('--cheek-x', String(1 + n * 0.1));
    hamster.style.setProperty('--cheek-y', String(1 + n * 0.03));
    pouchCount.textContent = `볼주머니 ${state.notes.length}개 · 할 일 ${open}개`;
    hamster.classList.toggle('urgent', state.notes.some((x) => !x.done && dueToday(x)));
    applyOutfit();
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

  // PC 앱: 붙인 메모 목록을 알려 주면 바탕화면 스티커 창을 열고/닫고/고친다
  const stickyApi = window.api && window.api.sticky;
  function syncStickies() {
    if (!stickyApi) return;
    stickyApi.sync(
      state.notes.filter((n) => n.sticky).map((n) => ({ id: n.id, text: n.text, color: n.color, done: n.done, sticky: n.sticky })),
    );
  }

  function render() {
    renderTabs();
    updateCheeks();
    syncStickies();
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
    meta.textContent = fmt(n.createdAt) + (n.editedAt ? ' · 고침' : '') + (n.sticky ? ' · 바탕화면에 붙임' : '');
    body.append(text, meta);

    const del = document.createElement('button');
    del.className = 'del';
    del.title = '꺼내기(삭제)';
    del.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>';
    del.addEventListener('click', () => removeNote(n.id));

    // PC 앱에서만: 바탕화면에 스티커 메모로 붙이기 / 떼기
    if (stickyApi) {
      const stick = document.createElement('button');
      stick.className = 'del stick' + (n.sticky ? ' on' : '');
      stick.title = n.sticky ? '바탕화면에서 떼기' : '바탕화면에 스티커로 붙이기';
      stick.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14"><path d="M15 3l6 6-3 1-4 4 1 5-2 2-4-4-5 5-1-1 5-5-4-4 2-2 5 1 4-4z" fill="currentColor"/></svg>';
      stick.addEventListener('click', () => {
        n.sticky = n.sticky ? null : {};
        render();
        scheduleSave();
        act('hop', 600);
        say(n.sticky ? '바탕화면에 붙여 뒀어요!' : '떼어서 볼주머니에 넣었어요');
      });
      el.append(check, body, stick, del);
    } else {
      el.append(check, body, del);
    }
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
    stayAwake();
    act('puff', 900);
    if (!fullCheck()) say(pick(LINES.add));
  }

  // 할 일이 12개를 넘으면 볼이 꽉 차서 부들부들
  function fullCheck() {
    const open = state.notes.filter((x) => !x.done).length;
    if (open <= 12) return false;
    setTimeout(() => act('full', 700), 500);
    say(pick(LINES.full), 4000);
    return true;
  }

  function toggleDone(id) {
    const n = state.notes.find((x) => x.id === id);
    if (!n) return;
    n.done = !n.done;
    if (n.done) n.doneAt = Date.now(); // 퇴근 전 알림의 "오늘 끝낸 일" 세기용
    else delete n.doneAt;
    const unlocked = n.done ? awardSeed(n) : null;
    render();
    scheduleSave();
    stayAwake();
    if (n.done) {
      act('hop', 600);
      act('happy', 900);
      const left = state.notes.filter((x) => !x.done).length;
      if (left === 0) {
        popSeeds(12);
        setTimeout(() => runWheel(), 700);
        say(pick(LINES.allDone), 4500);
      } else {
        popSeeds(1);
        say(pick(LINES.done));
      }
      if (unlocked) {
        setTimeout(() => {
          renderCloset();
          // 받침이 있으면 "을", 없으면 "를"
          const last = unlocked.name.charCodeAt(unlocked.name.length - 1) - 0xac00;
          const josa = last >= 0 && last % 28 ? '을' : '를';
          say(`${unlocked.icon} ${unlocked.name}${josa} 얻었어요! 🌻를 눌러 입혀 주세요`, 5000);
        }, left === 0 ? 4600 : 900);
      }
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

  // 쓰다듬기: 연달아 누를수록 기분이 좋아지고, 6번이면 발라당
  let petCount = 0;
  let petTimer;
  hamsterBtn.addEventListener('click', () => {
    if (hamster.classList.contains('sleepy')) {
      stayAwake();
      act('hop', 600);
      say(pick(LINES.wake));
      return;
    }
    petCount++;
    clearTimeout(petTimer);
    petTimer = setTimeout(() => (petCount = 0), 1500);
    if (petCount >= 6) {
      petCount = 0;
      act('flop', 2800);
      hearts(6);
      say('발라당~ 배 만져 주세요', 3000);
    } else if (petCount >= 3) {
      act('happy', 1200);
      act('hop', 600);
      hearts(2);
      say(pick(LINES.petHappy));
    } else {
      act('hop', 600);
      say(pick(LINES.pet));
    }
  });

  // 🌻 누르면 꾸미기 옷장
  $('seed-count')?.addEventListener('click', () => {
    const closet = $('closet');
    closet.hidden = !closet.hidden;
    if (!closet.hidden) renderCloset();
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
    $('btn-settings')?.addEventListener('click', () => window.api.settingsMenu());
    // 점심시간·퇴근 전 알림: Windows 알림 + 콩이 반응
    window.api.onReminder(({ kind }) => {
      const r = composeReminder(kind, state.notes);
      window.api.notify({ title: r.title, body: r.body });
      stayAwake();
      if (kind === 'lunch') act('puff', 900);
      else act('hop', 600);
      if (r.allDone) runWheel();
      say(r.body, 8000);
    });
    // 스티커 창에서 고친 글·옮긴 위치·떼기를 메모장에 반영
    stickyApi.onEdit((p) => {
      const n = state.notes.find((x) => x.id === p.id);
      if (!n) return;
      if (typeof p.text === 'string' && p.text !== n.text) {
        n.text = p.text;
        n.editedAt = Date.now();
        render();
      }
      if ('sticky' in p) {
        const wasStuck = !!n.sticky;
        n.sticky = p.sticky;
        if (wasStuck && !p.sticky) render(); // 스티커 창에서 × 를 눌러 뗌
      }
      scheduleSave();
    });
    // 스티커 창의 ✓ → 완료(씨앗·축하는 메모장과 똑같이) 하고 바탕화면에서 뗀다
    stickyApi.onDone(({ id }) => {
      const n = state.notes.find((x) => x.id === id);
      if (!n) return;
      n.sticky = null;
      if (!n.done) toggleDone(id);
      else { render(); scheduleSave(); }
    });
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
  let lastNod = 0;
  window.hamster = {
    say,
    act,
    eat,
    listening(on) {
      hamster.classList.toggle('listening', !!on);
      if (on) stayAwake();
      updateSleep();
    },
    // 회의 중 말소리가 들리면 끄덕끄덕 (너무 자주 하지 않게)
    nod() {
      const now = Date.now();
      if (now - lastNod < 700) return;
      lastNod = now;
      act('nod', 500);
    },
    addNoteText(text, color = 'peach') {
      text = String(text || '').trim();
      if (!text) return null;
      const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      state.notes.unshift({ id, text, color, done: false, createdAt: Date.now() });
      render();
      scheduleSave();
      act('puff', 900);
      fullCheck();
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
    updateSleep();
    const open = state.notes.filter((n) => !n.done).length;
    const urgent = state.notes.filter((n) => !n.done && dueToday(n)).length;
    if (hamster.classList.contains('sleepy')) say('쿨쿨… (눌러서 깨워 주세요)', 4000);
    else if (urgent) say(`오늘까지인 일이 ${urgent}개 있어요!`, 4500);
    else say(open ? `할 일이 ${open}개 있어요!` : pick(LINES[timeOfDay()]));
  });
})();

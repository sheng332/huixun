'use strict';

/* ------------------------------------------------------------
   基础工具
   ------------------------------------------------------------ */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-3);
const clone = (v) => JSON.parse(JSON.stringify(v));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const DEFAULT_FONT = '"Songti SC", "STSong", "SimSun", "Noto Serif SC", "Noto Serif CJK SC", serif';

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[c]));

const initialOf = (name) => {
  const chars = Array.from(String(name || '').trim());
  return chars[0] || '·';
};

const pad = (n) => String(n).padStart(2, '0');
const fmtTime = (ts) => {
  const d = new Date(ts);
  return pad(d.getHours()) + ':' + pad(d.getMinutes());
};
const stamp = () => {
  const d = new Date();
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
};

const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
const randomOf = (arr) => arr[Math.floor(Math.random() * arr.length)];

/* ------------------------------------------------------------
   默认数据
   ------------------------------------------------------------ */

function defaultState() {
  const gDaily = 'g_daily', gNight = 'g_night', gMisc = 'g_misc';
  return {
    v: 1,
    settings: {
      theme: 'auto',
      fontSize: 15,
      fontFamily: DEFAULT_FONT,
      fontUrl: '',
      bubbleCss: '',
      bg: '',
      showName: true,
      showAvatar: true,
      showTime: true,
      showRead: true,
      readText: '已读',
      delaySec: 4,
      activeEnabled: false,
      activeMin: 10,
      noReply: false,
      noReplyRate: 30,
      quote: false,
      combine: false,
      typing: true,
      typingText: '正在输入',
      notify: false,
      bgKeepAlive: true,
      sound: true,
      soundRandom: false,
      peerName: '林深',
      peerAvatar: '',
      selfName: '我',
      selfAvatar: ''
    },
    sounds: [
      { id: 's_blip', name: '轻响', kind: 'synth', preset: 'blip' },
      { id: 's_tick', name: '轻触', kind: 'synth', preset: 'tick' },
      { id: 's_chime', name: '余音', kind: 'synth', preset: 'chime' }
    ],
    groups: [
      { id: gDaily, name: '日常', hidden: false },
      { id: gNight, name: '夜', hidden: false },
      { id: gMisc, name: '未分组', hidden: false }
    ],
    cards: [
      { id: 'c1', groupId: gDaily, text: '嗯。', hidden: false },
      { id: 'c2', groupId: gDaily, text: '我在。', hidden: false },
      { id: 'c3', groupId: gDaily, text: '然后呢？', hidden: false },
      { id: 'c4', groupId: gDaily, text: '今天过得怎么样？', hidden: false },
      { id: 'c5', groupId: gNight, text: '晚安。', hidden: false },
      { id: 'c6', groupId: gNight, text: '早点睡。', hidden: false },
      { id: 'c7', groupId: gNight, text: '梦见我。', hidden: false },
      { id: 'c8', groupId: gMisc, text: '想你了。', hidden: false }
    ],
    messages: [
      { id: 'seed1', role: 'other', text: '在的。', ts: Date.now() - 60000, quote: null, read: true }
    ]
  };
}

function normalize(raw) {
  const base = defaultState();
  if (!raw || typeof raw !== 'object') return base;
  const out = Object.assign({}, base, raw);
  out.settings = Object.assign({}, base.settings, raw.settings || {});
  out.sounds = Array.isArray(raw.sounds) ? raw.sounds : base.sounds;
  out.groups = Array.isArray(raw.groups) && raw.groups.length ? raw.groups.filter(g => g && g.id) : base.groups;
  out.cards = Array.isArray(raw.cards) ? raw.cards.filter(c => c && c.id) : base.cards;
  out.messages = Array.isArray(raw.messages) ? raw.messages.filter(m => m && m.id) : base.messages;
  return out;
}

let S = defaultState();

/* ------------------------------------------------------------
   本地存储：IndexedDB，失败回退 localStorage
   ------------------------------------------------------------ */

const DB_NAME = 'echo-db';
const STORE = 'kv';
const LS_KEY = 'echo-state';
let dbPromise = null;

function openDB() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) return reject(new Error('no idb'));
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('blocked'));
    });
  }
  return dbPromise;
}

function idbGet() {
  return openDB().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get('root');
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  }));
}

function idbSet(value) {
  return openDB().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(value, 'root');
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  }));
}

function lsGet() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}
function lsSet(val) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(val)); return true; } catch (e) { return false; }
}

async function loadState() {
  try {
    const raw = await idbGet();
    if (raw) return JSON.parse(raw);
  } catch (e) { /* ignore */ }
  const raw = lsGet();
  return raw || null;
}

let saveTimer = null;
let saveCount = 0;

function save() {
  saveCount++;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(persist, 420);
}

async function persist() {
  clearTimeout(saveTimer);
  saveTimer = null;
  const snapshot = JSON.stringify(S);
  try {
    await idbSet(snapshot);
  } catch (e) {
    if (!lsSet(S)) console.warn('保存失败', e);
  }
  saveCount = 0;
}

window.addEventListener('pagehide', () => { if (saveCount) persist(); });
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden' && saveCount) persist();
});

/* ------------------------------------------------------------
   主题 / 字体 / 聊天外观
   ------------------------------------------------------------ */

const systemDark = window.matchMedia('(prefers-color-scheme: dark)');

function resolvedTheme() {
  if (S.settings.theme === 'light' || S.settings.theme === 'dark') return S.settings.theme;
  return systemDark.matches ? 'dark' : 'light';
}

function applyTheme() {
  const theme = resolvedTheme();
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  const meta = $('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', theme === 'dark' ? '#0c0c0d' : '#f2f2f0');
  $$('#themeSeg button').forEach((b) => b.classList.toggle('on', b.dataset.themeChoice === S.settings.theme));
}

systemDark.addEventListener('change', () => {
  if (S.settings.theme === 'auto') applyTheme();
});

function applyFonts() {
  const family = String(S.settings.fontFamily || '').trim() || DEFAULT_FONT;
  const url = String(S.settings.fontUrl || '').trim();
  let link = document.getElementById('echoFontLink');
  let face = document.getElementById('echoFontFace');

  if (!url) {
    if (link) link.remove();
    if (face) face.remove();
    document.documentElement.style.setProperty('--font-main', family);
  } else if (/\.(woff2?|ttf|otf|eot)(\?.*)?$/i.test(url)) {
    if (link) link.remove();
    if (!face) {
      face = document.createElement('style');
      face.id = 'echoFontFace';
      document.head.appendChild(face);
    }
    face.textContent = `@font-face{font-family:"EchoWeb";src:url("${url}");font-display:swap;}`;
    document.documentElement.style.setProperty('--font-main', `"EchoWeb", ${family}`);
  } else {
    if (face) face.remove();
    if (!link) {
      link = document.createElement('link');
      link.id = 'echoFontLink';
      link.rel = 'stylesheet';
      document.head.appendChild(link);
    }
    if (link.href !== url) link.href = url;
    document.documentElement.style.setProperty('--font-main', family);
  }

  document.documentElement.style.setProperty('--fs', `${S.settings.fontSize}px`);
}

function applyBubbleCss() {
  let style = document.getElementById('echoBubbleCss');
  if (!style) {
    style = document.createElement('style');
    style.id = 'echoBubbleCss';
    document.head.appendChild(style);
  }
  let link = document.getElementById('echoBubbleLink');
  const raw = String(S.settings.bubbleCss || '').trim();

  if (/^https?:\/\/\S+$/i.test(raw)) {
    style.textContent = '';
    if (!link) {
      link = document.createElement('link');
      link.id = 'echoBubbleLink';
      link.rel = 'stylesheet';
      document.head.appendChild(link);
    }
    if (link.href !== raw) link.href = raw;
  } else {
    if (link) link.remove();
    style.textContent = raw;
  }
}

function applyChatBg() {
  const bg = $('#chatBg');
  if (!bg) return;
  if (S.settings.bg) {
    bg.style.backgroundImage = `url("${S.settings.bg}")`;
    bg.classList.add('has-img');
  } else {
    bg.style.backgroundImage = '';
    bg.classList.remove('has-img');
  }
}

function applyChatClasses() {
  const chat = $('#app-chat');
  if (!chat) return;
  chat.classList.toggle('hide-name', !S.settings.showName);
  chat.classList.toggle('hide-avatar', !S.settings.showAvatar);
  chat.classList.toggle('hide-time', !S.settings.showTime);
  chat.classList.toggle('hide-read', !S.settings.showRead);
  $$('.m-read').forEach((el) => { el.textContent = S.settings.readText; });
}

function updateChatHeader() {
  const name = S.settings.peerName || '林深';
  const box = $('#chatPeerName');
  if (box) box.textContent = name;
  const av = $('#chatPeerAvatar');
  if (av) {
    if (S.settings.peerAvatar) av.innerHTML = `<img src="${S.settings.peerAvatar}" alt="">`;
    else av.textContent = initialOf(name);
  }
}

function applyAppearance() {
  applyTheme();
  applyFonts();
  applyBubbleCss();
  applyChatBg();
  applyChatClasses();
  updateChatHeader();
}

/* ------------------------------------------------------------
   音效
   ------------------------------------------------------------ */

let audioCtx = null;

function ensureAudio() {
  try {
    if (!audioCtx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return null;
      audioCtx = new Ctx();
    }
    if (audioCtx.state === 'suspended') audioCtx.resume();
    return audioCtx;
  } catch (e) { return null; }
}

document.addEventListener('pointerdown', ensureAudio, { once: true });

function synthSound(preset) {
  const ctx = ensureAudio();
  if (!ctx) return;
  const t = ctx.currentTime;
  const tones = {
    blip: [[620, .09, .045], [880, .07, .02]],
    tick: [[1180, .035, .035], [720, .05, .015]],
    chime: [[784, .34, .035], [1176, .28, .018], [1568, .2, .008]]
  }[preset] || [[660, .1, .04]];

  tones.forEach(([freq, dur, gain], i) => {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = preset === 'tick' ? 'triangle' : 'sine';
    osc.frequency.value = freq;
    g.gain.setValueAtTime(0, t + i * .02);
    g.gain.linearRampToValueAtTime(gain, t + i * .02 + .012);
    g.gain.exponentialRampToValueAtTime(.0001, t + (i * .02) + dur);
    osc.connect(g).connect(ctx.destination);
    osc.start(t + i * .02);
    osc.stop(t + (i * .02) + dur + .02);
  });
}

function playSoundItem(sound) {
  if (!sound) return;
  if (sound.kind === 'synth') {
    synthSound(sound.preset);
  } else if (sound.data) {
    try {
      const audio = new Audio(sound.data);
      audio.volume = .7;
      audio.play().catch(() => {});
    } catch (e) { /* ignore */ }
  } else if (sound.url) {
    try {
      const audio = new Audio(sound.url);
      audio.volume = .7;
      audio.play().catch(() => {});
    } catch (e) { /* ignore */ }
  }
}

function playSendSound() {
  if (!S.settings.sound || !S.sounds.length) return;
  const list = S.sounds.filter(s => s.kind === 'synth' || s.data || s.url);
  if (!list.length) return;
  const sound = S.settings.soundRandom ? randomOf(list) : list[0];
  playSoundItem(sound);
}

/* ------------------------------------------------------------
   后台保活
   ------------------------------------------------------------ */

let keepAliveAudio = null;
let keepAliveUrl = null;

function silentWavUrl() {
  if (keepAliveUrl) return keepAliveUrl;
  const n = 8000;
  const buf = new ArrayBuffer(44 + n * 2);
  const view = new DataView(buf);
  const write = (offset, text) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };
  write(0, 'RIFF');
  view.setUint32(4, 36 + n * 2, true);
  write(8, 'WAVEfmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 8000, true);
  view.setUint32(28, 16000, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(36, 'data');
  view.setUint32(40, n * 2, true);
  keepAliveUrl = URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
  return keepAliveUrl;
}

function startKeepAlive() {
  if (!S.settings.bgKeepAlive) return stopKeepAlive();
  if (keepAliveAudio) {
    keepAliveAudio.play().catch(() => {});
    return;
  }
  try {
    keepAliveAudio = new Audio(silentWavUrl());
    keepAliveAudio.loop = true;
    keepAliveAudio.play().catch(() => {});
  } catch (e) { keepAliveAudio = null; }
}

function stopKeepAlive() {
  if (!keepAliveAudio) return;
  try { keepAliveAudio.pause(); } catch (e) { /* ignore */ }
  keepAliveAudio = null;
}

document.addEventListener('pointerdown', () => {
  if (S.settings.bgKeepAlive) startKeepAlive();
}, { once: true });

document.addEventListener('visibilitychange', () => {
  if (document.hidden && S.settings.bgKeepAlive) startKeepAlive();
});

/* ------------------------------------------------------------
   弹层 / 提示 / 下载
   ------------------------------------------------------------ */

const sheet = $('#sheet');
const mask = $('#mask');
let sheetCloseCb = null;

function sheetShell(title, bodyHtml, extraHead = '') {
  return `
    <div class="sheet-head">
      <div class="sheet-title">${esc(title)}</div>
      ${extraHead}
      <button class="sheet-close" data-close-sheet aria-label="关闭"><svg class="ic"><use href="#i-close"></use></svg></button>
    </div>
    <div class="sheet-body">${bodyHtml}</div>`;
}

function openSheet(html, onClose) {
  closeSheet();
  sheet.innerHTML = html;
  sheet.classList.add('show');
  mask.classList.add('show');
  sheetCloseCb = onClose || null;
  const body = $('.sheet-body', sheet);
  if (body) body.scrollTop = 0;
}

function closeSheet() {
  if (!sheet.classList.contains('show')) {
    if (sheetCloseCb) { const cb = sheetCloseCb; sheetCloseCb = null; cb('close'); }
    return;
  }
  sheet.classList.remove('show');
  mask.classList.remove('show');
  const cb = sheetCloseCb;
  sheetCloseCb = null;
  if (cb) cb('close');
}

mask.addEventListener('click', closeSheet);
sheet.addEventListener('click', (e) => {
  if (e.target.closest('[data-close-sheet]')) closeSheet();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeSheet();
});

function menuSheet(title, items, onClose) {
  const body = `<div class="sheet-list">${items.map((it, i) => {
    const icon = it.icon ? `<svg class="ic"><use href="#${it.icon}"></use></svg>` : '';
    const check = it.checked ? `<span class="sheet-item-check"><svg class="ic"><use href="#i-check"></use></svg></span>` : '';
    return `<button class="sheet-item${it.danger ? ' danger' : ''}" data-menu-index="${i}">${icon}<span>${esc(it.label)}</span>${check}</button>`;
  }).join('')}</div>`;
  openSheet(sheetShell(title, body), onClose);
  $$('[data-menu-index]', sheet).forEach((btn) => {
    btn.addEventListener('click', () => {
      const item = items[Number(btn.dataset.menuIndex)];
      closeSheet();
      if (item) setTimeout(() => item.action && item.action(), 60);
    });
  });
}

function confirmSheet({ title = '确认', message = '', okText = '确定', cancelText = '取消', danger = true }) {
  return new Promise((resolve) => {
    let done = false;
    const body = `
      ${message ? `<p class="sheet-message">${esc(message)}</p>` : ''}
      <div class="sheet-actions">
        <button class="sheet-btn" id="confirmCancel">${esc(cancelText)}</button>
        <button class="sheet-btn ${danger ? 'danger' : 'primary'}" id="confirmOk">${esc(okText)}</button>
      </div>`;
    openSheet(sheetShell(title, body), () => {
      if (!done) { done = true; resolve(false); }
    });
    const cancel = $('#confirmCancel');
    const ok = $('#confirmOk');
    if (cancel) cancel.addEventListener('click', () => {
      if (done) return;
      done = true;
      closeSheet();
      resolve(false);
    });
    if (ok) ok.addEventListener('click', () => {
      if (done) return;
      done = true;
      closeSheet();
      resolve(true);
    });
  });
}

let toastTimer = null;
function toast(msg) {
  const el = $('#toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 1900);
}

function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 200);
}

function downloadText(filename, text, mime = 'application/json') {
  downloadBlob(filename, new Blob([text], { type: `${mime};charset=utf-8` }));
}

function readFileText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

function readFileDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function imageToDataURL(file, maxSide = 1400, quality = .84) {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
        const w = Math.max(1, Math.round(img.naturalWidth * scale));
        const h = Math.max(1, Math.round(img.naturalHeight * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        const png = /image\/png/i.test(file.type) && file.size < 900000;
        resolve(canvas.toDataURL(png ? 'image/png' : 'image/jpeg', quality));
      } catch (err) {
        reject(err);
      } finally {
        URL.revokeObjectURL(objectUrl);
      }
    };
    img.onerror = () => { URL.revokeObjectURL(objectUrl); reject(new Error('image')); };
    img.src = objectUrl;
  });
}

/* ------------------------------------------------------------
   界面导航 / 开场 / 时钟
   ------------------------------------------------------------ */

let currentApp = null;

function openApp(name) {
  const screen = document.getElementById('app-' + name);
  if (!screen) return;
  currentApp = name;
  $('#home').classList.add('pushed');
  screen.classList.add('open');
  if (name === 'chat' && typeof scrollChatBottom === 'function') scrollChatBottom(false);
  if (name === 'cards' && typeof renderCards === 'function') renderCards();
  if (name === 'settings' && typeof syncSettingsUI === 'function') syncSettingsUI();
}

function closeApp() {
  if (!currentApp) return;
  const screen = document.getElementById('app-' + currentApp);
  if (screen) screen.classList.remove('open');
  $('#home').classList.remove('pushed');
  currentApp = null;
  closeSheet();
}

function updateClock() {
  const d = new Date();
  const clock = $('#homeClock');
  const date = $('#homeDate');
  if (clock) clock.textContent = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (date) {
    const md = new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric' }).format(d);
    const wd = new Intl.DateTimeFormat('zh-CN', { weekday: 'long' }).format(d);
    date.textContent = `${md} · ${wd}`;
  }
}

let introDone = false;
function playIntro() {
  const intro = $('#intro');
  const finish = () => {
    if (introDone) return;
    introDone = true;
    if (intro) intro.classList.add('done');
    $('#home').classList.add('is-ready');
    setTimeout(() => { if (intro && intro.parentNode) intro.remove(); }, 1200);
  };
  if (!intro) { finish(); return; }
  intro.addEventListener('click', finish, { once: true });
  setTimeout(finish, 1850);
}

/* ------------------------------------------------------------
   核心事件
   ------------------------------------------------------------ */

function initCore() {
  $$('[data-open]').forEach((btn) => {
    btn.addEventListener('click', () => openApp(btn.dataset.open));
  });
  $$('[data-close-screen]').forEach((btn) => {
    btn.addEventListener('click', closeApp);
  });
  updateClock();
  setInterval(updateClock, 20000);
}

'use strict';

/* ------------------------------------------------------------
   对话：渲染、发送、回复引擎、主动消息
   ------------------------------------------------------------ */

let msgList = null;
let chatScroll = null;
let typingEl = null;
let flow = 0;
let flowBusy = false;
let proactiveTimer = null;
const waiters = new Set();

function speaker() {
  return { name: S.settings.peerName || '林深', avatar: S.settings.peerAvatar || '' };
}

function messageHTML(m) {
  const me = m.role === 'me';
  const sp = me
    ? { name: S.settings.selfName || '我', avatar: S.settings.selfAvatar || '' }
    : speaker();
  const avatar = `<span class="m-avatar">${
    sp.avatar ? `<img src="${sp.avatar}" alt="">` : esc(initialOf(sp.name))
  }</span>`;
  const quote = m.quote ? `<div class="quote">${esc(m.quote)}</div>` : '';
  let content;
  if (m.image) {
    content = `<div class="bubble image">${quote}<img src="${m.image}" alt="" loading="lazy"></div>`;
  } else if (m.sticker) {
    content = `<div class="bubble sticker">${quote}<img src="${m.sticker}" alt="" loading="lazy"></div>`;
  } else {
    content = `<div class="bubble">${quote}${esc(m.text)}</div>`;
  }
  const read = (me && m.read) ? `<span class="m-read">${esc(S.settings.readText)}</span>` : '';
  const saveBtn = (me && m.text) ? `<button class="m-act" data-save="${m.id}" aria-label="存入字卡"><svg class="ic"><use href="#i-bookmark"></use></svg></button>` : '';
  return `<div class="msg${me ? ' me' : ''}" data-id="${m.id}">
    ${avatar}
    <div class="m-body">
      ${content}
      <div class="m-meta">
        <span class="m-time">${fmtTime(m.ts)}</span>
        ${read}
        <span class="m-acts">
          ${saveBtn}
          <button class="m-act danger" data-del="${m.id}" aria-label="删除这条消息"><svg class="ic"><use href="#i-trash"></use></svg></button>
        </span>
      </div>
    </div>
  </div>`;
}

function renderMessages() {
  if (!msgList) return;
  msgList.innerHTML = S.messages.map(messageHTML).join('');
  requestAnimationFrame(() => scrollChatBottom(false));
}

function scrollChatBottom(smooth) {
  if (!chatScroll) return;
  requestAnimationFrame(() => {
    chatScroll.scrollTo({ top: chatScroll.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
  });
}

function appendMessage(m) {
  S.messages.push(m);
  if (msgList) {
    msgList.insertAdjacentHTML('beforeend', messageHTML(m));
    scrollChatBottom(true);
  }
  save();
  return m;
}

function markMyRead() {
  let changed = false;
  S.messages.forEach((m) => {
    if (m.role === 'me' && !m.read) {
      m.read = true;
      changed = true;
    }
  });
  if (!changed) return;
  $$('.msg.me', msgList).forEach((el) => {
    const m = S.messages.find((x) => x.id === el.dataset.id);
    if (!m || !m.read) return;
    let readEl = el.querySelector('.m-read');
    if (!readEl) {
      const timeEl = el.querySelector('.m-time');
      if (timeEl) {
        readEl = document.createElement('span');
        readEl.className = 'm-read';
        readEl.textContent = S.settings.readText;
        timeEl.after(readEl);
      }
    }
  });
  save();
}

/* ------------------------------------------------------------
   字卡抽取
   ------------------------------------------------------------ */

function availableCards() {
  const hiddenGroups = new Set(S.groups.filter((g) => g.hidden).map((g) => g.id));
  return S.cards.filter((c) => {
    if (c.hidden || hiddenGroups.has(c.groupId)) return false;
    if (c.type === 'sticker') return !!c.image;
    return !!String(c.text || '').trim();
  });
}

function shuffled(arr) {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function joinWithSymbols(texts) {
  const symbols = ['，', '？', '！'];
  const strip = (s) => String(s || '').trim().replace(/[，。！？、…；：,.!?;:]+$/g, '');
  const clean = texts.map(strip).filter(Boolean);
  return clean.reduce((acc, t, i) => (i === 0 ? t : acc + randomOf(symbols) + t), '');
}

function pickQuote() {
  const mine = S.messages.filter((m) => m.role === 'me' && m.text);
  if (!mine.length) return null;
  const recent = mine.slice(-10);
  return randomOf(recent).text;
}

/* ------------------------------------------------------------
   输入中 / 等待
   ------------------------------------------------------------ */

function showTyping() {
  if (!msgList || typingEl) return;
  typingEl = document.createElement('div');
  typingEl.className = 'msg typing';
  typingEl.innerHTML = `<div class="m-body"><div class="bubble">
    <span class="typing-text">${esc(S.settings.typingText || '正在输入')}</span>
    <span class="typing-dots"><i></i><i></i><i></i></span>
  </div></div>`;
  msgList.appendChild(typingEl);
  scrollChatBottom(true);
}

function hideTyping() {
  if (typingEl && typingEl.parentNode) typingEl.remove();
  typingEl = null;
}

function wait(ms) {
  return new Promise((resolve) => {
    const entry = {};
    entry.finish = (ok) => {
      if (entry.done) return;
      entry.done = true;
      clearTimeout(entry.timer);
      waiters.delete(entry);
      resolve(ok);
    };
    entry.timer = setTimeout(() => entry.finish(true), Math.max(0, ms));
    waiters.add(entry);
  });
}

function cancelFlows() {
  flow++;
  waiters.forEach((w) => w.finish(false));
  waiters.clear();
  hideTyping();
  flowBusy = false;
  clearTimeout(proactiveTimer);
  proactiveTimer = null;
}

function replyDelay() {
  const maxSec = clamp(Number(S.settings.delaySec) || 4, 1, 300);
  const minSec = clamp(Number(S.settings.minDelaySec) || 1, 1, Math.min(120, maxSec));
  const low = minSec * 1000;
  const high = Math.max(low, maxSec * 1000);
  return Math.round(low + Math.random() * (high - low));
}

/* ------------------------------------------------------------
   对方发言
   ------------------------------------------------------------ */

function notifyIncoming(text, sticker) {
  if (!S.settings.notify) return;
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  if (!document.hidden && $('#app-chat').classList.contains('open')) return;
  const body = sticker ? '[表情]' : text;
  const fallback = () => {
    try { new Notification('回讯', { body, tag: 'huixun-message', silent: true }); } catch (e) { /* ignore */ }
  };
  if (navigator.serviceWorker && navigator.serviceWorker.getRegistration) {
    navigator.serviceWorker.getRegistration().then((reg) => {
      if (!reg) return fallback();
      reg.showNotification('回讯', {
        body,
        tag: 'huixun-message',
        icon: './icons/icon-192.png',
        badge: './icons/icon-192.png',
        data: { url: './' },
        silent: true
      }).catch(fallback);
    }).catch(fallback);
  } else {
    fallback();
  }
}

function incoming(text, sticker) {
  const quote = (text && Math.random() * 100 < Number(S.settings.quoteProb || 0)) ? pickQuote() : null;
  const m = {
    id: uid(),
    role: 'other',
    text: text || '',
    sticker: sticker || '',
    ts: Date.now(),
    quote,
    read: true
  };
  appendMessage(m);
  markMyRead();
  playSendSound();
  notifyIncoming(text, sticker);
  maybeInAppBanner(text, sticker);
  return m;
}

async function runReplyFlow(opts = {}) {
  if (flowBusy) return;
  const pool = availableCards();
  if (!pool.length) return;
  const textPool = pool.filter((c) => c.type !== 'sticker');
  const stickerPool = pool.filter((c) => c.type === 'sticker');
  if (!textPool.length && !stickerPool.length) return;

  const my = ++flow;
  flowBusy = true;
  try {
    const items = [];
    if (textPool.length) {
      const picked = shuffled(textPool).slice(0, 1 + Math.floor(Math.random() * 3));
      const texts = picked.map((c) => String(c.text || '').trim()).filter(Boolean);
      const shouldCombine = texts.length > 1 && Math.random() * 100 < Number(S.settings.combineProb || 0);
      if (shouldCombine) items.push({ text: joinWithSymbols(texts) });
      else texts.forEach((t) => items.push({ text: t }));
    }
    if (stickerPool.length) {
      const mustSticker = !textPool.length;
      if (mustSticker || Math.random() * 100 < Number(S.settings.stickerProb || 0)) {
        const at = items.length > 1 && Math.random() < .5
          ? Math.floor(Math.random() * (items.length + 1))
          : items.length;
        items.splice(at, 0, { sticker: randomOf(stickerPool).image });
      }
    }

    for (const item of items) {
      if (my !== flow) return;
      if (S.settings.typing) showTyping();
      const ok = await wait(replyDelay());
      if (!ok || my !== flow) { hideTyping(); return; }
      hideTyping();
      incoming(item.text, item.sticker);
      const pause = await wait(260);
      if (!pause || my !== flow) return;
    }
  } finally {
    if (my === flow) {
      hideTyping();
      flowBusy = false;
    }
  }
}

function triggerReply() {
  if (!availableCards().length) {
    toast('字卡库是空的');
    return;
  }
  if (flowBusy) return;
  markMyRead();
  if (S.settings.noReply && Math.random() * 100 < Number(S.settings.noReplyRate || 0)) {
    return;
  }
  runReplyFlow();
}

function scheduleProactive() {
  clearTimeout(proactiveTimer);
  proactiveTimer = null;
  if (!S.settings.activeEnabled) return;
  const minutes = clamp(Number(S.settings.activeMin) || 10, 1, 60);
  const delay = Math.round((.22 + Math.random() * .78) * minutes * 60000);
  proactiveTimer = setTimeout(() => {
    proactiveTimer = null;
    scheduleProactive();
    if (flowBusy) return;
    if (!availableCards().length) return;
    runReplyFlow({ proactive: true });
  }, delay);
}

/* ------------------------------------------------------------
   用户发送
   ------------------------------------------------------------ */

function sendUserMessage() {
  const input = $('#msgInput');
  if (!input) return;
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  const m = {
    id: uid(),
    role: 'me',
    text,
    ts: Date.now(),
    quote: null,
    read: false
  };
  appendMessage(m);
  playSendSound();
  triggerReply();
}

function sendStickerMessage(image) {
  if (!image) return;
  const m = {
    id: uid(),
    role: 'me',
    text: '',
    sticker: image,
    ts: Date.now(),
    quote: null,
    read: false
  };
  appendMessage(m);
  playSendSound();
  triggerReply();
}

function sendImageMessage(image) {
  if (!image) return;
  const m = {
    id: uid(),
    role: 'me',
    text: '',
    image,
    ts: Date.now(),
    quote: null,
    read: false
  };
  appendMessage(m);
  playSendSound();
  triggerReply();
}

function openStickerSheet() {
  const stickers = availableCards().filter((c) => c.type === 'sticker');
  const grid = stickers.length
    ? stickers.map((c) => `<button class="sticker-pick" data-sticker="${c.id}"><img src="${c.image}" alt=""></button>`).join('')
    : '<div class="sticker-empty">还没有表情，去字卡库导入</div>';
  const body = `
    <div class="sticker-grid">${grid}</div>
    <button class="row action" id="sendImageBtn">
      <span>从相册发送图片</span><svg class="ic"><use href="#i-image"></use></svg>
    </button>
    <button class="row action" id="importStickerBtn">
      <span>从相册批量导入表情</span><svg class="ic"><use href="#i-upload"></use></svg>
    </button>`;
  openSheet(sheetShell('表情', body));

  const box = $('.sticker-grid', sheet);
  if (box) box.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-sticker]');
    if (!btn) return;
    const card = S.cards.find((c) => c.id === btn.dataset.sticker);
    if (!card || !card.image) return;
    closeSheet();
    sendStickerMessage(card.image);
  });

  const imageBtn = $('#sendImageBtn');
  if (imageBtn) imageBtn.addEventListener('click', () => {
    const file = $('#chatImageFile');
    if (file) file.click();
  });

  const importBtn = $('#importStickerBtn');
  if (importBtn) importBtn.addEventListener('click', () => {
    const file = $('#stickerImportFile');
    if (!file) return;
    closeSheet();
    file.click();
  });
}

/* ------------------------------------------------------------
   软件内新消息提示
   ------------------------------------------------------------ */

let bannerTimer = null;

function hideBanner() {
  const el = $('#msgBanner');
  if (el) el.classList.remove('show');
  clearTimeout(bannerTimer);
  bannerTimer = null;
}

function showBanner(text, sticker) {
  const el = $('#msgBanner');
  if (!el) return;
  const sp = speaker();
  const av = $('#bannerAvatar');
  if (av) {
    if (sp.avatar) av.innerHTML = `<img src="${sp.avatar}" alt="">`;
    else av.textContent = initialOf(sp.name);
  }
  const label = sticker ? '[表情]' : (text || '');
  const textEl = $('#bannerText');
  if (textEl) textEl.textContent = label;
  el.classList.add('show');
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(hideBanner, 9000);
}

function maybeInAppBanner(text, sticker) {
  if (!S.settings.inAppNotify) return;
  if (document.hidden) return;
  if (currentApp === 'chat') return;
  showBanner(text, sticker);
}

/* ------------------------------------------------------------
   查找聊天记录
   ------------------------------------------------------------ */

function openChatSearch() {
  const body = `
    <div class="search-field">
      <svg class="ic"><use href="#i-search"></use></svg>
      <input id="chatSearchInput" type="text" placeholder="搜索聊天记录" autocomplete="off">
    </div>
    <div class="chat-search-list" id="chatSearchList"><div class="empty-note">输入关键词查找</div></div>`;
  openSheet(sheetShell('查找聊天记录', body));

  const input = $('#chatSearchInput');
  const list = $('#chatSearchList');
  if (!input || !list) return;

  const render = () => {
    const q = input.value.trim().toLowerCase();
    if (!q) {
      list.innerHTML = '<div class="empty-note">输入关键词查找</div>';
      return;
    }
    const hits = S.messages.filter((m) => {
      const label = m.text || (m.image ? '[图片]' : m.sticker ? '[表情]' : '');
      return label.toLowerCase().includes(q);
    }).slice(-80).reverse();
    if (!hits.length) {
      list.innerHTML = '<div class="empty-note">没有找到</div>';
      return;
    }
    list.innerHTML = hits.map((m) => {
      const label = m.text || (m.image ? '[图片]' : '[表情]');
      return `<button class="chat-search-item" data-goto="${m.id}" onclick="gotoMessage('${m.id}')">
        <span class="cs-meta">${m.role === 'me' ? '我' : esc(speaker().name)} · ${fmtTime(m.ts)}</span>
        <span class="cs-text">${esc(label)}</span>
      </button>`;
    }).join('');
  };

  input.addEventListener('input', render);
  setTimeout(() => input.focus(), 120);
}

function gotoMessage(id) {
  closeSheet();
  setTimeout(() => highlightMessage(id), 160);
}

function highlightMessage(id) {
  if (!msgList) return;
  const el = msgList.querySelector(`.msg[data-id="${CSS.escape(id)}"]`);
  if (!el) return;
  el.classList.add('flash');
  try { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e) { /* ignore */ }
  setTimeout(() => el.classList.remove('flash'), 3600);
}

/* ------------------------------------------------------------
   弹层动作
   ------------------------------------------------------------ */

function deleteMessage(id) {
  const idx = S.messages.findIndex((m) => m.id === id);
  if (idx < 0) return;
  S.messages.splice(idx, 1);
  const el = msgList.querySelector(`.msg[data-id="${CSS.escape(id)}"]`);
  if (el) el.remove();
  save();
}

async function clearMessages() {
  const ok = await confirmSheet({
    title: '删除全部消息',
    message: '这段对话将被清空。',
    okText: '删除',
    danger: true
  });
  if (!ok) return;
  cancelFlows();
  S.messages = [];
  renderMessages();
  save();
  scheduleProactive();
}

function openChatMenu() {
  menuSheet('对话', [
    {
      label: '查找聊天记录',
      icon: 'i-search',
      action: openChatSearch
    },
    {
      label: '删除全部消息',
      icon: 'i-trash',
      danger: true,
      action: clearMessages
    }
  ]);
}

/* ------------------------------------------------------------
   初始化
   ------------------------------------------------------------ */

function initChat() {
  msgList = $('#msgList');
  chatScroll = $('#chatScroll');

  renderMessages();
  updateChatHeader();

  const input = $('#msgInput');
  const sendBtn = $('#sendBtn');
  const triggerBtn = $('#triggerBtn');
  const stickerBtn = $('#stickerBtn');

  if (sendBtn) sendBtn.addEventListener('click', sendUserMessage);
  if (stickerBtn) stickerBtn.addEventListener('click', openStickerSheet);
  if (input) {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.isComposing) {
        e.preventDefault();
        sendUserMessage();
      }
    });
  }
  if (triggerBtn) triggerBtn.addEventListener('click', () => {
    triggerReply();
    scrollChatBottom(true);
  });
  const menuBtn = $('#chatMenuBtn');
  if (menuBtn) menuBtn.addEventListener('click', openChatMenu);

  const imageFile = $('#chatImageFile');
  if (imageFile) imageFile.addEventListener('change', async () => {
    const file = imageFile.files && imageFile.files[0];
    if (!file) return;
    try {
      toast('正在发送');
      const img = await imageToDataURL(file, 1200, .82);
      closeSheet();
      sendImageMessage(img);
    } catch (e) {
      toast('图片读取失败');
    }
    imageFile.value = '';
  });

  const banner = $('#msgBanner');
  if (banner) banner.addEventListener('click', () => {
    hideBanner();
    if (currentApp && currentApp !== 'chat') {
      const prev = document.getElementById('app-' + currentApp);
      if (prev) prev.classList.remove('open');
    }
    openApp('chat');
    setTimeout(() => scrollChatBottom(true), 120);
  });

  if (msgList) {
    msgList.addEventListener('click', (e) => {
      const delBtn = e.target.closest('[data-del]');
      if (delBtn) {
        e.stopPropagation();
        deleteMessage(delBtn.dataset.del);
        return;
      }
      const saveBtn = e.target.closest('[data-save]');
      if (saveBtn) {
        e.stopPropagation();
        const m = S.messages.find((x) => x.id === saveBtn.dataset.save);
        if (m && typeof openCardEditor === 'function') openCardEditor(null, m.text);
        return;
      }
      const msg = e.target.closest('.msg');
      if (!msg || msg.classList.contains('typing')) return;
      const wasOpen = msg.classList.contains('show-meta');
      $$('.msg.show-meta', msgList).forEach((el) => el.classList.remove('show-meta'));
      if (!wasOpen) {
        msg.classList.add('show-meta');
        scrollChatBottom(false);
      }
    });
  }

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) scrollChatBottom(false);
  });
}

window.addEventListener('resize', () => {
  if (currentApp === 'chat') scrollChatBottom(false);
});

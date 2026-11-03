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
  const sp = speaker();
  const avatar = me ? '' : `<span class="m-avatar">${
    sp.avatar ? `<img src="${sp.avatar}" alt="">` : esc(initialOf(sp.name))
  }</span>`;
  const name = (!me) ? `<span class="m-name">${esc(sp.name)}</span>` : '';
  const quote = m.quote ? `<div class="quote">${esc(m.quote)}</div>` : '';
  const content = m.sticker
    ? `<div class="bubble sticker">${quote}<img src="${m.sticker}" alt="" loading="lazy"></div>`
    : `<div class="bubble">${quote}${esc(m.text)}</div>`;
  const read = (me && m.read) ? `<span class="m-read">${esc(S.settings.readText)}</span>` : '';
  const saveBtn = (me && m.text) ? `<button class="m-act" data-save="${m.id}" aria-label="存入字卡"><svg class="ic"><use href="#i-bookmark"></use></svg></button>` : '';
  return `<div class="msg${me ? ' me' : ''}" data-id="${m.id}">
    ${avatar}
    <div class="m-body">
      ${name}
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
  const symbols = ['，', '、', '；', '…', ' '];
  const endsWithPunct = (s) => /[，。！？、…；,.!?;:：""''」』）)]$/.test(s);
  return texts.reduce((acc, t, i) => {
    if (i === 0) return t;
    return acc + (endsWithPunct(acc) ? '' : randomOf(symbols)) + t;
  }, '');
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
  const base = clamp(Number(S.settings.delaySec) || 4, 1, 300) * 1000;
  return Math.round(base * (.35 + Math.random() * .65));
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
  const quote = (text && S.settings.quote) ? pickQuote() : null;
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
  return m;
}

async function runReplyFlow(opts = {}) {
  if (flowBusy) return;
  const pool = availableCards();
  if (!pool.length) return;

  const my = ++flow;
  flowBusy = true;
  try {
    const picked = shuffled(pool).slice(0, 1 + Math.floor(Math.random() * 3));
    const items = [];
    if (S.settings.combine) {
      const texts = picked.filter((c) => c.type !== 'sticker').map((c) => String(c.text || '').trim()).filter(Boolean);
      if (texts.length) items.push({ text: joinWithSymbols(texts) });
      picked.filter((c) => c.type === 'sticker').forEach((c) => items.push({ sticker: c.image }));
    } else {
      picked.forEach((c) => {
        if (c.type === 'sticker') items.push({ sticker: c.image });
        else items.push({ text: String(c.text || '').trim() });
      });
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

  if (sendBtn) sendBtn.addEventListener('click', sendUserMessage);
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

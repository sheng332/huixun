'use strict';

/* ------------------------------------------------------------
   字卡库
   ------------------------------------------------------------ */

let cardSearch = '';
let cardGroup = 'all';
let cardSort = 'default';
let cardTab = 'text';
let manageMode = false;
const selectedCards = new Set();

function groupOptionsHTML(selectedId) {
  return S.groups.map((g) => `<option value="${g.id}"${g.id === selectedId ? ' selected' : ''}>${esc(g.name)}</option>`).join('');
}

function ensureGroup(name) {
  const clean = String(name || '').trim() || '未分组';
  let g = S.groups.find((x) => x.name === clean);
  if (!g) {
    g = { id: uid(), name: clean, hidden: false };
    S.groups.push(g);
  }
  return g.id;
}

function isSticker(card) {
  return !!(card && card.type === 'sticker' && card.image);
}

function stickerKey(image) {
  return `${image.length}:${image.slice(0, 48)}:${image.slice(-24)}`;
}

function cardExists(text, exceptId) {
  const key = String(text || '').trim();
  if (!key) return true;
  return S.cards.some((c) => c.id !== exceptId && !isSticker(c) && String(c.text || '').trim() === key);
}

function sortedCards(list) {
  const out = list.slice();
  if (cardSort === 'alpha') {
    out.sort((a, b) => {
      if (isSticker(a) !== isSticker(b)) return isSticker(a) ? 1 : -1;
      return String(a.text || '').localeCompare(String(b.text || ''), 'zh-CN');
    });
  } else if (cardSort === 'new') {
    out.reverse();
  }
  return out;
}

function activeCardList() {
  const q = cardTab === 'text' ? cardSearch.trim().toLowerCase() : '';
  return S.cards.filter((c) => {
    if (cardTab === 'sticker' ? !isSticker(c) : isSticker(c)) return false;
    if (cardGroup !== 'all' && c.groupId !== cardGroup) return false;
    if (q && !String(c.text || '').toLowerCase().includes(q)) return false;
    return true;
  });
}

function cardItemHTML(card) {
  const on = selectedCards.has(card.id);
  const content = isSticker(card)
    ? `<img class="card-thumb" src="${card.image}" alt="" loading="lazy">`
    : `<span class="card-text">${esc(card.text)}</span>`;
  return `<div class="card-item${card.hidden ? ' hidden-card' : ''}${isSticker(card) ? ' sticker' : ''}" data-card="${card.id}">
    <span class="check${on ? ' on' : ''}" data-check="${card.id}"><svg class="ic"><use href="#i-check"></use></svg></span>
    ${content}
    ${card.hidden ? '<span class="card-flag"><svg class="ic"><use href="#i-eyeoff"></use></svg></span>' : ''}
  </div>`;
}

function renderGroupChips() {
  const box = $('#groupChips');
  if (!box) return;
  const chips = [`<button class="chip${cardGroup === 'all' ? ' active' : ''}" data-group="all">全部</button>`];
  S.groups.forEach((g) => {
    chips.push(`<button class="chip${cardGroup === g.id ? ' active' : ''}${g.hidden ? ' off' : ''}" data-group="${g.id}">${esc(g.name)}</button>`);
  });
  box.innerHTML = chips.join('');
}

function syncCardTabs() {
  const textCount = S.cards.filter((c) => !isSticker(c)).length;
  const stickerCount = S.cards.filter(isSticker).length;
  const textEl = $('#textTabCount');
  const stickerEl = $('#stickerTabCount');
  if (textEl) textEl.textContent = String(textCount);
  if (stickerEl) stickerEl.textContent = String(stickerCount);
  $$('#cardTabs [data-card-tab]').forEach((btn) => {
    btn.classList.toggle('on', btn.dataset.cardTab === cardTab);
  });
  const search = $('#cardSearch');
  if (search) {
    search.placeholder = cardTab === 'sticker' ? '表情包' : '搜索字卡';
    search.disabled = cardTab === 'sticker';
  }
  const toolbar = $('.cards-toolbar');
  if (toolbar) toolbar.classList.toggle('off', cardTab === 'sticker');
  const fab = $('#addCardBtn');
  if (fab) fab.setAttribute('aria-label', cardTab === 'sticker' ? '导入表情包' : '添加字卡');
}

function renderCards() {
  const body = $('#cardsBody');
  if (!body) return;
  if (cardGroup !== 'all' && !S.groups.some((g) => g.id === cardGroup)) cardGroup = 'all';

  syncCardTabs();
  const list = sortedCards(activeCardList());
  const q = cardSearch.trim();

  if (cardTab === 'sticker') {
    body.innerHTML = list.length
      ? `<div class="sticker-wall">${list.map(cardItemHTML).join('')}</div>`
      : `<div class="empty-note">还没有表情包，点右下角从相册导入</div>`;
    body.classList.toggle('manage', manageMode);
    updateBatchBar();
    renderGroupChips();
    return;
  }

  const groups = cardGroup === 'all'
    ? S.groups
    : S.groups.filter((g) => g.id === cardGroup);

  let html = '';
  groups.forEach((g) => {
    const items = list.filter((c) => c.groupId === g.id);
    if (q && !items.length) return;
    html += `<div class="group-head${g.hidden ? ' off' : ''}">
      <span class="group-name">${esc(g.name)}</span>
      <span class="group-count">${items.length}</span>
      <button class="group-menu" data-group-menu="${g.id}" aria-label="分组操作"><svg class="ic"><use href="#i-more"></use></svg></button>
    </div>`;
    html += items.map(cardItemHTML).join('');
  });

  if (!html) {
    html = `<div class="empty-note">${q ? '没有找到' : '还没有字卡'}</div>`;
  }

  body.innerHTML = html;
  body.classList.toggle('manage', manageMode);
  updateBatchBar();
  renderGroupChips();
}

function updateBatchBar() {
  const count = selectedCards.size;
  const countEl = $('#batchCount');
  if (countEl) countEl.textContent = String(count);
  const buttons = ['#batchMove', '#batchHide', '#batchDelete'].map((s) => $(s));
  buttons.forEach((b) => { if (b) b.disabled = count === 0; });
}

function setManageMode(on) {
  manageMode = on;
  if (!on) selectedCards.clear();
  const btn = $('#cardManageBtn');
  if (btn) {
    btn.textContent = on ? '完成' : '选择';
    btn.classList.toggle('active', on);
  }
  const fab = $('#addCardBtn');
  if (fab) fab.classList.toggle('hide', on);
  const bar = $('#batchBar');
  if (bar) bar.classList.toggle('show', on);
  renderCards();
}

function toggleCardSelection(id) {
  if (selectedCards.has(id)) selectedCards.delete(id);
  else selectedCards.add(id);
  const el = $(`.card-item[data-card="${CSS.escape(id)}"]`);
  if (el) {
    const check = el.querySelector('.check');
    if (check) check.classList.toggle('on', selectedCards.has(id));
  }
  updateBatchBar();
}

/* ------------------------------------------------------------
   添加 / 编辑
   ------------------------------------------------------------ */

function openAddCardSheet(initialTab) {
  const defaultGroup = S.groups[0] ? S.groups[0].id : ensureGroup('未分组');
  const body = `
    <div class="sheet-tabs">
      <button data-add-tab="single" class="${initialTab === 'batch' ? '' : 'on'}">单个</button>
      <button data-add-tab="batch" class="${initialTab === 'batch' ? 'on' : ''}">批量</button>
    </div>
    <div data-panel="single">
      <label class="sheet-label">字卡</label>
      <textarea class="sheet-textarea" id="addText" placeholder="写一句想说的话"></textarea>
      <label class="sheet-label">分组</label>
      <select class="sheet-select" id="addGroup">${groupOptionsHTML(defaultGroup)}</select>
      <div class="sheet-actions">
        <button class="sheet-btn" data-close-sheet>取消</button>
        <button class="sheet-btn primary" id="addSave">添加</button>
      </div>
    </div>
    <div data-panel="batch" style="display:none">
      <label class="sheet-label">字卡</label>
      <textarea class="sheet-textarea" id="batchText" rows="8" placeholder="【日常】&#10;今天过得怎么样？&#10;嗯。&#10;【夜】&#10;晚安。"></textarea>
      <label class="sheet-label">默认分组</label>
      <select class="sheet-select" id="batchGroup">${groupOptionsHTML(defaultGroup)}</select>
      <div class="sheet-actions">
        <button class="sheet-btn" data-close-sheet>取消</button>
        <button class="sheet-btn primary" id="batchSave">添加</button>
      </div>
    </div>`;
  openSheet(sheetShell('添加字卡', body));

  $$('[data-add-tab]', sheet).forEach((btn) => {
    btn.addEventListener('click', () => {
      $$('[data-add-tab]', sheet).forEach((b) => b.classList.toggle('on', b === btn));
      $$('[data-panel]', sheet).forEach((p) => {
        p.style.display = p.dataset.panel === btn.dataset.addTab ? '' : 'none';
      });
    });
  });

  const singleSave = $('#addSave');
  if (singleSave) singleSave.addEventListener('click', () => {
    const text = $('#addText').value.trim();
    if (!text) return;
    if (cardExists(text)) { toast('已存在'); return; }
    S.cards.push({ id: uid(), groupId: $('#addGroup').value, text, hidden: false });
    save();
    closeSheet();
    renderCards();
    toast('已添加');
  });

  const batchSave = $('#batchSave');
  if (batchSave) batchSave.addEventListener('click', () => {
    const raw = $('#batchText').value;
    if (!raw.trim()) return;
    const result = importCardsFromText(raw, $('#batchGroup').value);
    save();
    closeSheet();
    renderCards();
    toast(`已添加 ${result.added} 张`);
  });
}

function importCardsFromText(raw, defaultGroupId) {
  let current = defaultGroupId || (S.groups[0] && S.groups[0].id) || ensureGroup('未分组');
  let added = 0;
  let skipped = 0;
  const lines = String(raw).replace(/\r/g, '').split('\n');
  lines.forEach((rawLine) => {
    const line = rawLine.trim();
    if (!line) return;
    const mark = line.match(/^【(.+)】$/);
    if (mark) {
      current = ensureGroup(mark[1]);
      return;
    }
    if (cardExists(line)) { skipped++; return; }
    S.cards.push({ id: uid(), groupId: current, text: line, hidden: false });
    added++;
  });
  return { added, skipped };
}

function openCardEditor(cardId, prefillText) {
  const card = cardId ? S.cards.find((c) => c.id === cardId) : null;

  if (card && isSticker(card)) {
    const body = `
      <div class="sticker-preview"><img src="${card.image}" alt=""></div>
      <label class="sheet-label">分组</label>
      <select class="sheet-select" id="editGroup">${groupOptionsHTML(card.groupId)}</select>
      <div class="sheet-row">
        <span class="row-label">屏蔽</span>
        <input type="checkbox" class="switch" id="editHidden"${card.hidden ? ' checked' : ''}>
      </div>
      <div class="sheet-actions">
        <button class="sheet-btn danger" id="editDelete">删除</button>
        <button class="sheet-btn" data-close-sheet>取消</button>
        <button class="sheet-btn primary" id="editSave">保存</button>
      </div>`;
    openSheet(sheetShell('表情包', body));

    $('#editSave').addEventListener('click', () => {
      card.groupId = $('#editGroup').value;
      card.hidden = $('#editHidden').checked;
      save();
      closeSheet();
      renderCards();
      toast('已保存');
    });

    $('#editDelete').addEventListener('click', async () => {
      const ok = await confirmSheet({ title: '删除表情', message: '这个表情将被移除。', okText: '删除' });
      if (!ok) return;
      S.cards = S.cards.filter((c) => c.id !== card.id);
      save();
      closeSheet();
      renderCards();
      toast('已删除');
    });
    return;
  }

  const text = card ? card.text : (prefillText || '');
  const gid = card ? card.groupId : (S.groups[0] ? S.groups[0].id : ensureGroup('未分组'));
  const body = `
    <label class="sheet-label">字卡</label>
    <textarea class="sheet-textarea" id="editText" placeholder="写一句想说的话">${esc(text)}</textarea>
    <label class="sheet-label">分组</label>
    <select class="sheet-select" id="editGroup">${groupOptionsHTML(gid)}</select>
    <div class="sheet-row">
      <span class="row-label">屏蔽</span>
      <input type="checkbox" class="switch" id="editHidden"${card && card.hidden ? ' checked' : ''}>
    </div>
    <div class="sheet-actions">
      ${card ? '<button class="sheet-btn danger" id="editDelete">删除</button>' : ''}
      <button class="sheet-btn" data-close-sheet>取消</button>
      <button class="sheet-btn primary" id="editSave">保存</button>
    </div>`;
  openSheet(sheetShell(card ? '编辑字卡' : '存入字卡', body));

  const saveBtn = $('#editSave');
  if (saveBtn) saveBtn.addEventListener('click', () => {
    const nextText = $('#editText').value.trim();
    if (!nextText) return;
    if (cardExists(nextText, card ? card.id : null)) { toast('已存在'); return; }
    const groupId = $('#editGroup').value;
    const hidden = $('#editHidden').checked;
    if (card) {
      card.text = nextText;
      card.groupId = groupId;
      card.hidden = hidden;
    } else {
      S.cards.push({ id: uid(), groupId, text: nextText, hidden });
    }
    save();
    closeSheet();
    renderCards();
    toast(card ? '已保存' : '已存入字卡');
  });

  const delBtn = $('#editDelete');
  if (delBtn) delBtn.addEventListener('click', async () => {
    const ok = await confirmSheet({
      title: '删除字卡',
      message: '这张字卡将被移除。',
      okText: '删除'
    });
    if (!ok) return;
    S.cards = S.cards.filter((c) => c.id !== card.id);
    save();
    closeSheet();
    renderCards();
    toast('已删除');
  });
}

/* ------------------------------------------------------------
   分组
   ------------------------------------------------------------ */

function openGroupMenu(gid) {
  const g = S.groups.find((x) => x.id === gid);
  if (!g) return;
  const count = S.cards.filter((c) => c.groupId === g.id).length;
  menuSheet(g.name, [
    {
      label: '重命名',
      icon: 'i-edit',
      action: () => renameGroup(g)
    },
    {
      label: g.hidden ? '取消屏蔽' : '屏蔽分组',
      icon: 'i-eyeoff',
      action: () => {
        g.hidden = !g.hidden;
        save();
        renderCards();
        toast(g.hidden ? '已屏蔽' : '已取消屏蔽');
      }
    },
    {
      label: `删除分组${count ? `（${count}）` : ''}`,
      icon: 'i-trash',
      danger: true,
      action: async () => {
        const ok = await confirmSheet({
          title: '删除分组',
          message: count ? `同时删除其中的 ${count} 张字卡。` : '',
          okText: '删除'
        });
        if (!ok) return;
        S.cards = S.cards.filter((c) => c.groupId !== g.id);
        S.groups = S.groups.filter((x) => x.id !== g.id);
        if (cardGroup === g.id) cardGroup = 'all';
        save();
        renderCards();
        toast('已删除');
      }
    }
  ]);
}

function renameGroup(g) {
  const body = `
    <label class="sheet-label">分组名称</label>
    <input class="sheet-input" id="renameInput" type="text" maxlength="16" value="${esc(g.name)}">
    <div class="sheet-actions">
      <button class="sheet-btn" data-close-sheet>取消</button>
      <button class="sheet-btn primary" id="renameSave">保存</button>
    </div>`;
  openSheet(sheetShell('重命名', body));
  const input = $('#renameInput');
  const saveBtn = $('#renameSave');
  if (saveBtn) saveBtn.addEventListener('click', () => {
    const name = input.value.trim();
    if (!name) return;
    g.name = name;
    save();
    closeSheet();
    renderCards();
  });
}

function openGroupManager() {
  if (!S.groups.length) { toast('还没有分组'); return; }
  const selected = new Set();

  const rows = S.groups.map((g) => {
    const count = S.cards.filter((c) => c.groupId === g.id).length;
    return `<div class="group-pick-row" data-select-group="${g.id}"${g.hidden ? ' data-off="1"' : ''}>
      <span class="check" data-group-check="${g.id}"><svg class="ic"><use href="#i-check"></use></svg></span>
      <span class="member-name"${g.hidden ? ' style="opacity:.55"' : ''}>${esc(g.name)}</span>
      <span class="member-sub">${count}${g.hidden ? ' · 屏蔽' : ''}</span>
      <button class="row-mini-btn" data-group-menu="${g.id}" aria-label="分组操作"><svg class="ic"><use href="#i-more"></use></svg></button>
    </div>`;
  }).join('');

  const body = `<p class="sheet-note">勾选后可批量删除，分组内的字卡与表情也会一并删除。</p>
    <div id="groupManageList">${rows}</div>
    <button class="row action" id="newGroupBtn"><span>新建分组</span><svg class="ic"><use href="#i-plus"></use></svg></button>
    <div class="sheet-actions">
      <button class="sheet-btn" id="groupSelectAll">全选</button>
      <button class="sheet-btn danger" id="groupBatchDelete" disabled>删除选中</button>
    </div>`;
  openSheet(sheetShell('分组', body));

  const list = $('#groupManageList');
  const delBtn = $('#groupBatchDelete');
  const allBtn = $('#groupSelectAll');

  const sync = () => {
    S.groups.forEach((g) => {
      const row = list && list.querySelector(`[data-select-group="${CSS.escape(g.id)}"]`);
      if (!row) return;
      row.querySelector('.check').classList.toggle('on', selected.has(g.id));
    });
    if (allBtn) allBtn.textContent = selected.size === S.groups.length ? '取消全选' : '全选';
    if (delBtn) {
      delBtn.disabled = !selected.size;
      delBtn.textContent = selected.size ? `删除选中（${selected.size}）` : '删除选中';
    }
  };

  if (list) list.addEventListener('click', (e) => {
    const menuBtn = e.target.closest('[data-group-menu]');
    if (menuBtn) {
      e.stopPropagation();
      openGroupMenu(menuBtn.dataset.groupMenu);
      return;
    }
    const row = e.target.closest('[data-select-group]');
    if (!row) return;
    const id = row.dataset.selectGroup;
    if (selected.has(id)) selected.delete(id);
    else selected.add(id);
    sync();
  });

  if (allBtn) allBtn.addEventListener('click', () => {
    if (selected.size === S.groups.length) selected.clear();
    else S.groups.forEach((g) => selected.add(g.id));
    sync();
  });

  if (delBtn) delBtn.addEventListener('click', async () => {
    if (!selected.size) return;
    const ids = new Set(selected);
    const ok = await confirmSheet({
      title: '删除分组',
      message: `将删除 ${ids.size} 个分组，及其中全部字卡与表情。`,
      okText: '删除'
    });
    if (!ok) {
      openGroupManager();
      return;
    }
    S.groups = S.groups.filter((g) => !ids.has(g.id));
    S.cards = S.cards.filter((c) => !ids.has(c.groupId));
    if (ids.has(cardGroup)) cardGroup = 'all';
    selectedCards.clear();
    save();
    renderCards();
    toast(`已删除 ${ids.size} 个分组`);
  });

  const newBtn = $('#newGroupBtn');
  if (newBtn) newBtn.addEventListener('click', () => {
    const body = `
      <label class="sheet-label">分组名称</label>
      <input class="sheet-input" id="groupInput" type="text" maxlength="16">
      <div class="sheet-actions">
        <button class="sheet-btn" data-close-sheet>取消</button>
        <button class="sheet-btn primary" id="groupSave">创建</button>
      </div>`;
    openSheet(sheetShell('新建分组', body));
    const saveBtn = $('#groupSave');
    saveBtn.addEventListener('click', () => {
      const name = $('#groupInput').value.trim();
      if (!name) return;
      if (S.groups.some((g) => g.name === name)) { toast('分组已存在'); return; }
      ensureGroup(name);
      save();
      closeSheet();
      renderCards();
    });
  });
}

/* ------------------------------------------------------------
   批量操作
   ------------------------------------------------------------ */

function batchMove() {
  if (!selectedCards.size) return;
  const target = S.groups[0] ? S.groups[0].id : ensureGroup('未分组');
  const body = `
    <label class="sheet-label">移动到</label>
    <select class="sheet-select" id="moveGroup">${groupOptionsHTML(target)}</select>
    <div class="sheet-actions">
      <button class="sheet-btn" data-close-sheet>取消</button>
      <button class="sheet-btn primary" id="moveSave">移动</button>
    </div>`;
  openSheet(sheetShell('移动字卡', body));
  $('#moveSave').addEventListener('click', () => {
    const gid = $('#moveGroup').value;
    const n = selectedCards.size;
    S.cards.forEach((c) => { if (selectedCards.has(c.id)) c.groupId = gid; });
    save();
    closeSheet();
    setManageMode(false);
    toast(`已移动 ${n} 张`);
  });
}

function batchHide() {
  if (!selectedCards.size) return;
  const n = selectedCards.size;
  S.cards.forEach((c) => { if (selectedCards.has(c.id)) c.hidden = true; });
  save();
  setManageMode(false);
  toast(`已屏蔽 ${n} 张`);
}

async function batchDelete() {
  if (!selectedCards.size) return;
  const n = selectedCards.size;
  const ok = await confirmSheet({
    title: '删除字卡',
    message: `将删除 ${n} 张字卡。`,
    okText: '删除'
  });
  if (!ok) return;
  S.cards = S.cards.filter((c) => !selectedCards.has(c.id));
  selectedCards.clear();
  save();
  setManageMode(false);
  toast('已删除');
}

/* ------------------------------------------------------------
   导入导出 / 去重
   ------------------------------------------------------------ */

function exportCards() {
  if (!S.cards.some((c) => !isSticker(c))) { toast('没有字卡'); return; }
  const lines = [];
  S.groups.forEach((g) => {
    const cards = S.cards.filter((c) => c.groupId === g.id && !isSticker(c) && String(c.text || '').trim());
    if (!cards.length) return;
    lines.push(`【${g.name}】`);
    cards.forEach((c) => lines.push(c.text));
  });
  const txt = '\ufeff' + lines.join('\n') + '\n';
  downloadText(`huixun-cards-${stamp()}.txt`, txt, 'text/plain');
}

function exportMochi() {
  if (!S.cards.length) { toast('没有字卡'); return; }
  const text = [];
  const sticker = [];
  S.groups.forEach((g) => {
    const words = S.cards.filter((c) => c.groupId === g.id && !isSticker(c) && String(c.text || '').trim()).map((c) => c.text);
    if (words.length) text.push([g.name, words]);
    const images = S.cards.filter((c) => c.groupId === g.id && isSticker(c)).map((c) => c.image);
    if (images.length) sticker.push([g.name, images]);
  });
  const out = { text, sticker };
  downloadText(`huixun-cards-${stamp()}.json`, JSON.stringify(out), 'application/json');
}

const MOCHI_TEXT_KEYS = ['text', 'kaomoji', 'emoji', 'poke', 'cjian', 'interact'];

function isMochiData(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
  return MOCHI_TEXT_KEYS.concat('sticker').some((k) => Array.isArray(data[k]));
}

function importMochi(data, defaultGroupId) {
  let textAdded = 0;
  let stickerAdded = 0;
  let skipped = 0;
  const existing = new Set(S.cards.filter(isSticker).map((c) => stickerKey(c.image)));

  const eachGroup = (value, fn) => {
    if (!Array.isArray(value)) return;
    value.forEach((pair) => {
      if (!Array.isArray(pair) || !Array.isArray(pair[1])) return;
      const name = String(pair[0] || '').trim();
      const gid = name ? ensureGroup(name) : (defaultGroupId || ensureGroup('未分组'));
      pair[1].forEach((item) => fn(gid, item));
    });
  };

  MOCHI_TEXT_KEYS.forEach((key) => eachGroup(data[key], (gid, item) => {
    const text = typeof item === 'string' ? item : (item && typeof item.text === 'string' ? item.text : '');
    const clean = text.trim();
    if (!clean || cardExists(clean)) { skipped++; return; }
    S.cards.push({ id: uid(), groupId: gid, text: clean, hidden: false });
    textAdded++;
  }));

  eachGroup(data.sticker, (gid, item) => {
    const image = typeof item === 'string' ? item : (item && (item.data || item.url || item.image)) || '';
    if (!/^(data:image\/|https?:)/i.test(image)) { skipped++; return; }
    const fp = stickerKey(image);
    if (existing.has(fp)) { skipped++; return; }
    existing.add(fp);
    S.cards.push({ id: uid(), groupId: gid, type: 'sticker', image, hidden: false });
    stickerAdded++;
  });

  return { textAdded, stickerAdded, skipped };
}

function importCardsFile() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.txt,.json,text/plain,application/json';
  input.addEventListener('change', async () => {
    const file = input.files && input.files[0];
    if (!file) return;
    const isJson = /\.json$/i.test(file.name || '') || String(file.type).includes('json');
    toast('正在导入');
    try {
      const raw = (await readFileText(file)).replace(/^\ufeff/, '');
      let result;
      if (isJson) {
        const data = JSON.parse(raw);
        if (!isMochiData(data)) throw new Error('format');
        result = importMochi(data, S.groups[0] ? S.groups[0].id : ensureGroup('未分组'));
      } else {
        const text = importCardsFromText(raw, S.groups[0] ? S.groups[0].id : ensureGroup('未分组'));
        result = { textAdded: text.added, stickerAdded: 0, skipped: text.skipped };
      }
      save();
      renderCards();
      const parts = [];
      if (result.textAdded) parts.push(`${result.textAdded} 张字卡`);
      if (result.stickerAdded) parts.push(`${result.stickerAdded} 个表情`);
      toast(parts.length ? `已导入 ${parts.join('、')}` : '没有新内容');
    } catch (e) {
      toast('文件格式不支持');
    }
  });
  input.click();
}

function compressSticker(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        const scale = Math.min(1, 340 / Math.max(img.naturalWidth, img.naturalHeight));
        const w = Math.max(1, Math.round(img.naturalWidth * scale));
        const h = Math.max(1, Math.round(img.naturalHeight * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        const keepAlpha = /png|webp|gif|svg/i.test(file.type || '');
        resolve(canvas.toDataURL(keepAlpha ? 'image/png' : 'image/jpeg', .82));
      } catch (err) {
        reject(err);
      } finally {
        URL.revokeObjectURL(url);
      }
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('image')); };
    img.src = url;
  });
}

async function importStickersFromAlbum(files) {
  const list = Array.from(files || []).filter((f) => /image\//i.test(f.type || ''));
  if (!list.length) return;
  const gid = ensureGroup('表情');
  const existing = new Set(S.cards.filter(isSticker).map((c) => stickerKey(c.image)));
  let added = 0;
  toast('正在导入');
  for (const file of list) {
    try {
      const image = await compressSticker(file);
      const key = stickerKey(image);
      if (existing.has(key)) continue;
      existing.add(key);
      S.cards.push({ id: uid(), groupId: gid, type: 'sticker', image, hidden: false });
      added++;
    } catch (e) { /* 跳过无法识别的图片 */ }
  }
  save();
  cardTab = 'sticker';
  cardGroup = 'all';
  renderCards();
  toast(added ? `已导入 ${added} 个表情` : '没有新表情');
}

function dedupeCards() {
  const seen = new Set();
  const kept = [];
  let removed = 0;
  S.cards.forEach((c) => {
    if (isSticker(c)) {
      const key = `s:${stickerKey(c.image)}`;
      if (seen.has(key)) { removed++; return; }
      seen.add(key);
      kept.push(c);
      return;
    }
    const key = `t:${String(c.text || '').trim()}`;
    if (!String(c.text || '').trim() || seen.has(key)) { removed++; return; }
    seen.add(key);
    kept.push(c);
  });
  S.cards = kept;
  if (removed) {
    save();
    renderCards();
    toast(`去除 ${removed} 项`);
  } else {
    toast('没有重复');
  }
}

/* ------------------------------------------------------------
   初始化
   ------------------------------------------------------------ */

function initCards() {
  renderCards();

  const search = $('#cardSearch');
  if (search) search.addEventListener('input', () => {
    cardSearch = search.value;
    renderCards();
  });

  const chips = $('#groupChips');
  if (chips) chips.addEventListener('click', (e) => {
    const chip = e.target.closest('[data-group]');
    if (!chip) return;
    cardGroup = chip.dataset.group;
    selectedCards.clear();
    renderCards();
  });

  const manageBtn = $('#cardManageBtn');
  if (manageBtn) manageBtn.addEventListener('click', () => setManageMode(!manageMode));

  const body = $('#cardsBody');
  if (body) body.addEventListener('click', (e) => {
    const menuBtn = e.target.closest('[data-group-menu]');
    if (menuBtn) { e.stopPropagation(); openGroupMenu(menuBtn.dataset.groupMenu); return; }
    const item = e.target.closest('.card-item');
    if (!item) return;
    const id = item.dataset.card;
    if (manageMode) {
      toggleCardSelection(id);
    } else {
      openCardEditor(id);
    }
  });

  const tabs = $('#cardTabs');
  if (tabs) tabs.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-card-tab]');
    if (!btn || btn.dataset.cardTab === cardTab) return;
    cardTab = btn.dataset.cardTab;
    cardGroup = 'all';
    if (search) search.value = '';
    cardSearch = '';
    selectedCards.clear();
    if (manageMode) setManageMode(false);
    renderCards();
  });

  const addBtn = $('#addCardBtn');
  if (addBtn) addBtn.addEventListener('click', () => {
    if (cardTab === 'sticker') {
      const f = $('#stickerImportFile');
      if (f) f.click();
    } else {
      openAddCardSheet('single');
    }
  });

  const sortBtn = $('#cardSortBtn');
  if (sortBtn) sortBtn.addEventListener('click', () => {
    menuSheet('排序', [
      { label: '默认', checked: cardSort === 'default', action: () => { cardSort = 'default'; renderCards(); } },
      { label: '最新', checked: cardSort === 'new', action: () => { cardSort = 'new'; renderCards(); } },
      { label: 'A → Z', checked: cardSort === 'alpha', action: () => { cardSort = 'alpha'; renderCards(); } }
    ]);
  });

  const menuBtn = $('#cardMenuBtn');
  if (menuBtn) menuBtn.addEventListener('click', () => {
    menuSheet('字卡库', [
      { label: '批量添加', icon: 'i-plus', action: () => openAddCardSheet('batch') },
      { label: '导入字卡 / 表情', icon: 'i-upload', action: importCardsFile },
      { label: '相册批量导入表情', icon: 'i-image', action: () => { const f = $('#stickerImportFile'); if (f) f.click(); } },
      { label: '导出 txt', icon: 'i-download', action: exportCards },
      { label: '导出字卡库 JSON', icon: 'i-download', action: exportMochi },
      { label: '分组', icon: 'i-move', action: openGroupManager },
      { label: '清理重复', icon: 'i-reset', action: dedupeCards }
    ]);
  });

  const allBtn = $('#batchAll');
  if (allBtn) allBtn.addEventListener('click', () => {
    activeCardList().forEach((c) => selectedCards.add(c.id));
    renderCards();
  });
  const stickerImport = $('#stickerImportFile');
  if (stickerImport) stickerImport.addEventListener('change', () => {
    const files = Array.from(stickerImport.files || []);
    stickerImport.value = '';
    if (files.length) importStickersFromAlbum(files);
  });
  const moveBtn = $('#batchMove');
  if (moveBtn) moveBtn.addEventListener('click', batchMove);
  const hideBtn = $('#batchHide');
  if (hideBtn) hideBtn.addEventListener('click', batchHide);
  const delBtn = $('#batchDelete');
  if (delBtn) delBtn.addEventListener('click', batchDelete);
}

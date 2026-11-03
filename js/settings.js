'use strict';

/* ------------------------------------------------------------
   设置
   ------------------------------------------------------------ */

const NUMERIC_SETTINGS = new Set([
  'fontSize', 'delaySec', 'minDelaySec', 'activeMin', 'noReplyRate',
  'quoteProb', 'combineProb', 'stickerProb'
]);

function updateValueLabels() {
  const set = (id, text) => { const el = $(id); if (el) el.textContent = text; };
  const fmtSec = (value) => {
    const sec = Number(value) || 0;
    return sec >= 60 ? `${Math.floor(sec / 60)} 分${sec % 60 ? ` ${sec % 60} 秒` : ''}` : `${sec} 秒`;
  };
  set('#delayVal', fmtSec(S.settings.delaySec));
  set('#minDelayVal', fmtSec(S.settings.minDelaySec));
  set('#activeVal', `${S.settings.activeMin} 分钟`);
  set('#noReplyVal', `${S.settings.noReplyRate}%`);
  set('#quoteVal', `${S.settings.quoteProb}%`);
  set('#combineVal', `${S.settings.combineProb}%`);
  set('#stickerVal', `${S.settings.stickerProb}%`);
  set('#fontVal', `${S.settings.fontSize}`);
}

function syncDependentRows() {
  $$('[data-dep]').forEach((row) => {
    const key = row.dataset.dep;
    const show = !!S.settings[key];
    row.classList.toggle('hide', !show);
  });
}

function paintPreview(el, img, fallbackText) {
  if (!el) return;
  if (img) {
    el.style.backgroundImage = `url("${img}")`;
    el.textContent = '';
  } else {
    el.style.backgroundImage = '';
    el.textContent = fallbackText || '';
  }
}

function updatePreviews() {
  const bgs = [
    ['#bgPreview', S.settings.bg],
    ['#homeBgPreview', S.settings.homeBg],
    ['#cardBgPreview', S.settings.cardBg]
  ];
  bgs.forEach(([sel, img]) => {
    const el = $(sel);
    if (el) el.style.backgroundImage = img ? `url("${img}")` : '';
  });
  paintPreview($('#peerAvatarPreview'), S.settings.peerAvatar, initialOf(S.settings.peerName));
  paintPreview($('#selfAvatarPreview'), S.settings.selfAvatar, initialOf(S.settings.selfName || '我'));
}

function syncSettingsUI() {
  $$('[data-setting]').forEach((el) => {
    const key = el.dataset.setting;
    const value = S.settings[key];
    if (el.type === 'checkbox') {
      el.checked = !!value;
    } else if (document.activeElement !== el) {
      el.value = value;
    }
  });
  updateValueLabels();
  syncDependentRows();
  updatePreviews();
  applyTheme();
}

/* ------------------------------------------------------------
   音效
   ------------------------------------------------------------ */

function renderSounds() {
  const box = $('#soundList');
  if (!box) return;
  if (!S.sounds.length) {
    box.innerHTML = '<div class="sound-row"><span class="member-name" style="color:var(--ink-3);font-size:12px">空</span></div>';
    return;
  }
  box.innerHTML = S.sounds.map((s) => `
    <div class="sound-row">
      <button class="sound-play" data-play-sound="${s.id}" aria-label="试听"><svg class="ic"><use href="#i-play"></use></svg></button>
      <span class="member-name">${esc(s.name)}</span>
      <span class="sound-kind">${s.kind === 'synth' ? '内置' : (s.kind === 'url' ? '链接' : '音频')}</span>
      <button class="row-mini-btn" data-del-sound="${s.id}" aria-label="删除"><svg class="ic"><use href="#i-trash"></use></svg></button>
    </div>`).join('');
}

function openSoundSheet() {
  let soundData = '';
  const body = `
    <label class="sheet-label">名称</label>
    <input class="sheet-input" id="soundName" type="text" maxlength="12" placeholder="音效">
    <div class="sheet-row">
      <span class="row-label">音频文件</span>
      <span class="mini-actions">
        <span class="sound-kind" id="soundFileLabel">未选择</span>
        <label class="mini-btn">选择<input type="file" id="soundFile" accept="audio/*" hidden></label>
      </span>
    </div>
    <label class="sheet-label">链接</label>
    <input class="sheet-input" id="soundUrl" type="text" placeholder="音频 URL" spellcheck="false">
    <div class="sheet-actions">
      <button class="sheet-btn" data-close-sheet>取消</button>
      <button class="sheet-btn primary" id="soundSave">添加</button>
    </div>`;
  openSheet(sheetShell('添加音效', body));

  const file = $('#soundFile');
  file.addEventListener('change', async () => {
    if (!file.files || !file.files[0]) return;
    const f = file.files[0];
    if (f.size > 5 * 1024 * 1024) { toast('文件过大'); return; }
    try {
      soundData = await readFileDataURL(f);
      $('#soundFileLabel').textContent = f.name.slice(0, 16);
      $('#soundUrl').value = '';
    } catch (e) { toast('读取失败'); }
  });

  $('#soundSave').addEventListener('click', () => {
    const name = $('#soundName').value.trim() || '音效';
    const url = $('#soundUrl').value.trim();
    if (!soundData && !url) { toast('选择文件或填入链接'); return; }
    S.sounds.push(soundData
      ? { id: uid(), name, kind: 'data', data: soundData }
      : { id: uid(), name, kind: 'url', url });
    save();
    closeSheet();
    renderSounds();
    toast('已添加');
  });
}

/* ------------------------------------------------------------
   设置事件
   ------------------------------------------------------------ */

function handleNotifyToggle(on) {
  if (!on) return;
  if (!('Notification' in window)) {
    S.settings.notify = false;
    syncSettingsUI();
    save();
    toast('不支持通知');
    return;
  }
  if (Notification.permission !== 'granted') {
    Notification.requestPermission().then((permission) => {
      if (permission !== 'granted') {
        S.settings.notify = false;
        syncSettingsUI();
        save();
        toast('通知未开启');
      }
    });
  }
}

function onSettingEvent(e) {
  const el = e.target.closest('[data-setting]');
  if (!el) return;
  const key = el.dataset.setting;
  let value;
  if (el.type === 'checkbox') value = el.checked;
  else if (el.type === 'range' || el.type === 'number') value = Number(el.value);
  else value = el.value;

  if (NUMERIC_SETTINGS.has(key)) value = Number(value);

  S.settings[key] = value;
  if (key === 'delaySec' && value < Number(S.settings.minDelaySec || 0)) {
    S.settings.minDelaySec = value;
  }
  if (key === 'minDelaySec' && value > Number(S.settings.delaySec || 0)) {
    S.settings.delaySec = value;
  }
  save();

  applyAppearance();
  updateValueLabels();
  syncDependentRows();
  if (key === 'delaySec' || key === 'minDelaySec') {
    const minEl = $('[data-setting="minDelaySec"]');
    const maxEl = $('[data-setting="delaySec"]');
    if (minEl) minEl.value = S.settings.minDelaySec;
    if (maxEl) maxEl.value = S.settings.delaySec;
  }

  if (key === 'activeEnabled' || key === 'activeMin') scheduleProactive();
  if (key === 'notify') handleNotifyToggle(value);
  if (key === 'bgKeepAlive') {
    if (value) startKeepAlive();
    else stopKeepAlive();
  }
  if (key === 'peerName' || key === 'peerAvatar') {
    if (typeof renderMessages === 'function') renderMessages();
    updatePreviews();
  }
  if (key === 'showRead' || key === 'readText') applyChatClasses();
}

function bindImageSetting({ pick, file, clear, apply }, maxSide, quality) {
  const pickEl = $(pick);
  const fileEl = $(file);
  const clearEl = $(clear);
  if (pickEl && fileEl) {
    pickEl.addEventListener('click', () => fileEl.click());
    fileEl.addEventListener('change', async () => {
      if (!fileEl.files || !fileEl.files[0]) return;
      try {
        const img = await imageToDataURL(fileEl.files[0], maxSide, quality);
        apply(img);
        updatePreviews();
        save();
        toast('已更新');
      } catch (e) { toast('图片读取失败'); }
      fileEl.value = '';
    });
  }
  if (clearEl) {
    clearEl.addEventListener('click', () => {
      apply('');
      updatePreviews();
      save();
    });
  }
}

function initSettings() {
  const root = $('#app-settings');
  if (!root) return;

  root.addEventListener('input', (e) => {
    const el = e.target.closest('[data-setting]');
    if (!el) return;
    if (el.type === 'checkbox') return;
    onSettingEvent(e);
  });

  root.addEventListener('change', (e) => {
    const el = e.target.closest('[data-setting]');
    if (!el) return;
    if (el.type === 'range' || el.tagName === 'SELECT' || el.type === 'checkbox') {
      onSettingEvent(e);
    }
  });

  $$('#themeSeg button').forEach((btn) => {
    btn.addEventListener('click', () => {
      S.settings.theme = btn.dataset.themeChoice;
      applyTheme();
      save();
    });
  });

  const bgFile = $('#bgFile');
  const bgPick = $('#bgPick');
  if (bgPick && bgFile) {
    bgPick.addEventListener('click', () => bgFile.click());
    bgFile.addEventListener('change', async () => {
      if (!bgFile.files || !bgFile.files[0]) return;
      try {
        S.settings.bg = await imageToDataURL(bgFile.files[0], 1600, .82);
        applyChatBg();
        updatePreviews();
        save();
        toast('已设置背景');
      } catch (e) { toast('图片读取失败'); }
      bgFile.value = '';
    });
  }
  const bgClear = $('#bgClear');
  if (bgClear) bgClear.addEventListener('click', () => {
    S.settings.bg = '';
    applyChatBg();
    updatePreviews();
    save();
    toast('已清除背景');
  });

  const avatarFile = $('#avatarFile');
  const avatarPick = $('#peerAvatarPick');
  if (avatarPick && avatarFile) {
    avatarPick.addEventListener('click', () => avatarFile.click());
    avatarFile.addEventListener('change', async () => {
      if (!avatarFile.files || !avatarFile.files[0]) return;
      try {
        S.settings.peerAvatar = await imageToDataURL(avatarFile.files[0], 240, .86);
        updateChatHeader();
        applyHome();
        updatePreviews();
        renderMessages();
        save();
      } catch (e) { toast('图片读取失败'); }
      avatarFile.value = '';
    });
  }
  const avatarClear = $('#peerAvatarClear');
  if (avatarClear) avatarClear.addEventListener('click', () => {
    S.settings.peerAvatar = '';
    updateChatHeader();
    applyHome();
    updatePreviews();
    renderMessages();
    save();
  });

  bindImageSetting({
    pick: '#selfAvatarPick', file: '#selfAvatarFile', clear: '#selfAvatarClear',
    apply: (img) => { S.settings.selfAvatar = img; applyHome(); }
  }, 240, .86);

  bindImageSetting({
    pick: '#homeBgPick', file: '#homeBgFile', clear: '#homeBgClear',
    apply: (img) => { S.settings.homeBg = img; applyHome(); }
  }, 1600, .82);

  bindImageSetting({
    pick: '#cardBgPick', file: '#cardBgFile', clear: '#cardBgClear',
    apply: (img) => { S.settings.cardBg = img; applyHome(); }
  }, 1200, .82);

  const bubbleReset = $('#bubbleReset');
  if (bubbleReset) bubbleReset.addEventListener('click', () => {
    S.settings.bubbleCss = '';
    const area = $('[data-setting="bubbleCss"]');
    if (area) area.value = '';
    applyBubbleCss();
    save();
  });

  const soundList = $('#soundList');
  if (soundList) soundList.addEventListener('click', (e) => {
    const play = e.target.closest('[data-play-sound]');
    if (play) {
      const sound = S.sounds.find((s) => s.id === play.dataset.playSound);
      playSoundItem(sound);
      return;
    }
    const del = e.target.closest('[data-del-sound]');
    if (del) {
      S.sounds = S.sounds.filter((s) => s.id !== del.dataset.delSound);
      save();
      renderSounds();
      toast('已删除');
    }
  });

  const addSound = $('#addSoundBtn');
  if (addSound) addSound.addEventListener('click', openSoundSheet);

  const exportBtn = $('#exportAllBtn');
  if (exportBtn) exportBtn.addEventListener('click', exportAll);

  const importBtn = $('#importAllBtn');
  const allImport = $('#allImport');
  if (importBtn && allImport) {
    importBtn.addEventListener('click', () => allImport.click());
    allImport.addEventListener('change', async () => {
      if (!allImport.files || !allImport.files[0]) return;
      try {
        const raw = await readFileText(allImport.files[0]);
        const data = JSON.parse(raw.replace(/^\ufeff/, ''));
        if (!data || !data.settings || !Array.isArray(data.cards)) throw new Error('bad');
        allImport.value = '';
        const ok = await confirmSheet({
          title: '导入全部',
          message: '当前所有数据将被覆盖。',
          okText: '导入',
          danger: false
        });
        if (!ok) return;
        cancelFlows();
        S = normalize(data);
        await persist();
        refreshAll();
        toast('已导入');
      } catch (e) {
        allImport.value = '';
        toast('文件无效');
      }
    });
  }

  const clearBtn = $('#clearMsgsBtn');
  if (clearBtn) clearBtn.addEventListener('click', clearMessages);

  const resetBtn = $('#resetAllBtn');
  if (resetBtn) resetBtn.addEventListener('click', async () => {
    const ok = await confirmSheet({
      title: '重置全部',
      message: '所有字卡、对话与设置都将清除。',
      okText: '重置'
    });
    if (!ok) return;
    cancelFlows();
    S = defaultState();
    await persist();
    refreshAll();
    toast('已重置');
  });
}

/* ------------------------------------------------------------
   全部导入导出 / 刷新
   ------------------------------------------------------------ */

function exportAll() {
  downloadText(`huixun-backup-${stamp()}.json`, JSON.stringify(S, null, 2));
}

function refreshAll() {
  applyAppearance();
  syncSettingsUI();
  renderSounds();
  renderCards();
  renderMessages();
  updateChatHeader();
  scheduleProactive();
}

'use strict';

/* ------------------------------------------------------------
   启动
   ------------------------------------------------------------ */

async function boot() {
  try {
    const loaded = await loadState();
    if (loaded) S = normalize(loaded);
  } catch (e) {
    console.warn('读取失败', e);
  }

  applyAppearance();
  initCore();
  initChat();
  initCards();
  initSettings();

  renderSounds();
  syncSettingsUI();
  updateChatHeader();
  scheduleProactive();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
  startKeepAlive();

  playIntro();
}

boot();

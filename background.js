// now Flow v8.0 - background.js
// Fix1: chrome.scripting.executeScript + window.__nowFlowLoaded guard

let offscreenCreated = false;

// ── 오프스크린 문서 생성 ──────────────────────────────────────────
async function ensureOffscreen() {
  if (offscreenCreated) return;
  const existing = await chrome.offscreen.hasDocument().catch(() => false);
  if (!existing) {
    await chrome.offscreen.createDocument({
      url: chrome.runtime.getURL('offscreen.html'),
      reasons: ['BLOBS'],
      justification: 'Blob download for now Flow'
    });
  }
  offscreenCreated = true;
}

// ── content.js 주입 (Fix1: __nowFlowLoaded guard) ────────────────
async function injectContent(tabId) {
  try {
    // guard: 이미 로드됐으면 스킵
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => window.__nowFlowLoaded === true
    });
    if (results && results[0] && results[0].result === true) {
      console.log('[nowFlow] content.js already loaded, skip inject');
      return { ok: true, skipped: true };
    }
    // 주입
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content.js']
    });
    console.log('[nowFlow] content.js injected to tab', tabId);
    return { ok: true };
  } catch (e) {
    console.error('[nowFlow] inject error:', e.message);
    return { ok: false, error: e.message };
  }
}

// ── 사이드패널 열기 ──────────────────────────────────────────────
chrome.action.onClicked.addListener(async (tab) => {
  try {
    await chrome.sidePanel.open({ tabId: tab.id });
    await chrome.sidePanel.setOptions({
      tabId: tab.id,
      path: 'sidepanel.html',
      enabled: true
    });
  } catch (e) {
    console.error('[nowFlow] sidePanel open error:', e.message);
  }
});

// ── 메시지 라우터 ────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const action = msg.action || msg.type;

  // content.js 주입 요청
  if (action === 'INJECT_CONTENT') {
    injectContent(msg.tabId).then(sendResponse);
    return true;
  }

  // 오프스크린 다운로드
  if (action === 'OFFSCREEN_DOWNLOAD' || action === 'offscreen_download') {
    ensureOffscreen().then(() => {
      chrome.runtime.sendMessage({ ...msg, action: 'OFFSCREEN_DOWNLOAD' })
        .catch(e => console.error('[nowFlow] offscreen msg error:', e.message));
    });
    sendResponse({ ok: true });
    return true;
  }

  // 결과 전달 (offscreen → sidepanel)
  if (action === 'SAVE_RESULT') {
    // 사이드패널로 브로드캐스트
    chrome.runtime.sendMessage(msg).catch(() => {});
    sendResponse({ ok: true });
    return true;
  }

  // START 명령: content.js 주입 후 START 전달
  if (action === 'START') {
    (async () => {
      try {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tabs || !tabs[0]) { sendResponse({ ok: false, error: 'No active tab' }); return; }
        const tab = tabs[0];
        if (!tab.url || !tab.url.includes('labs.google')) {
          sendResponse({ ok: false, error: 'Not a Google Flow tab' });
          return;
        }
        await injectContent(tab.id);
        await chrome.tabs.sendMessage(tab.id, msg);
        sendResponse({ ok: true });
      } catch (e) {
        sendResponse({ ok: false, error: e.message });
      }
    })();
    return true;
  }

  // PAUSE / RESUME / STOP / RESET → 현재 탭으로 전달
  if (['PAUSE','RESUME','STOP','RESET'].includes(action)) {
    (async () => {
      try {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tabs && tabs[0]) {
          await chrome.tabs.sendMessage(tabs[0].id, msg).catch(() => {});
        }
        sendResponse({ ok: true });
      } catch (e) {
        sendResponse({ ok: false, error: e.message });
      }
    })();
    return true;
  }

  return false;
});

// ── 탭 업데이트 감지 ─────────────────────────────────────────────
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url && tab.url.includes('labs.google/fx/tools/flow')) {
    console.log('[nowFlow] Google Flow tab detected:', tabId);
  }
});

console.log('[nowFlow] background.js v8.0 loaded');

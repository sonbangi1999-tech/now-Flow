// now Flow v8.1 - background.js
// Fix: offscreen relay 수정 / START URL 체크 완화 / tabs 권한 추가

let offscreenCreated = false;

// ── 오프스크린 문서 생성 ──────────────────────────────────────────
async function ensureOffscreen() {
  try {
    const existing = await chrome.offscreen.hasDocument();
    if (!existing) {
      await chrome.offscreen.createDocument({
        url: chrome.runtime.getURL('offscreen.html'),
        reasons: ['BLOBS'],
        justification: 'Blob download for now Flow'
      });
    }
    offscreenCreated = true;
  } catch (e) {
    console.error('[nowFlow] ensureOffscreen error:', e.message);
    offscreenCreated = false;
    throw e;
  }
}

// ── content.js 주입 (guard: __nowFlowLoaded) ─────────────────────
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

  // ── OFFSCREEN_DOWNLOAD: content.js → background → offscreen ──
  // [Fix] chrome.runtime.sendMessage는 offscreen에 도달하지 않음
  //       → ensureOffscreen 후 chrome.tabs 대신 offscreen 전용 채널로 전달
  if (action === 'OFFSCREEN_DOWNLOAD' || action === 'offscreen_download') {
    // offscreen 자신이 보낸 메시지(SAVE_RESULT 재전송 방지)는 무시
    if (sender && sender.url && sender.url.includes('offscreen.html')) {
      return false;
    }
    ensureOffscreen().then(() => {
      // offscreen document는 chrome.runtime.sendMessage로 수신 가능
      // (service worker → offscreen: runtime.sendMessage 사용)
      chrome.runtime.sendMessage({
        ...msg,
        action: 'OFFSCREEN_DOWNLOAD',
        _fromBackground: true
      }).catch(e => console.error('[nowFlow] offscreen send error:', e.message));
    }).catch(e => console.error('[nowFlow] ensureOffscreen error:', e.message));
    sendResponse({ ok: true });
    return true;
  }

  // ── SAVE_RESULT: offscreen → sidepanel 브로드캐스트 ──
  if (action === 'SAVE_RESULT') {
    // 사이드패널(extension page)으로 broadcast
    chrome.runtime.sendMessage({ ...msg, _fromBackground: true })
      .catch(() => {});
    sendResponse({ ok: true });
    return true;
  }

  // ── START: content.js 주입 후 START 전달 ──
  if (action === 'START') {
    (async () => {
      try {
        // Fix: labs.google 도메인 체크 완화 (서브도메인/경로 무관하게 허용)
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tabs || !tabs[0]) {
          sendResponse({ ok: false, error: 'No active tab' });
          return;
        }
        const tab = tabs[0];
        const url = tab.url || '';
        if (!url.includes('labs.google') && !url.includes('flow')) {
          sendResponse({ ok: false, error: `Not a Google Flow tab (url: ${url})` });
          return;
        }
        const injectResult = await injectContent(tab.id);
        if (!injectResult.ok) {
          sendResponse({ ok: false, error: 'inject failed: ' + injectResult.error });
          return;
        }
        // 주입 직후 약간 대기 (content.js 초기화 시간)
        await new Promise(r => setTimeout(r, 300));
        await chrome.tabs.sendMessage(tab.id, msg);
        sendResponse({ ok: true });
      } catch (e) {
        sendResponse({ ok: false, error: e.message });
      }
    })();
    return true;
  }

  // ── PAUSE / RESUME / STOP / RESET → 현재 탭으로 전달 ──
  if (['PAUSE', 'RESUME', 'STOP', 'RESET'].includes(action)) {
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
  if (changeInfo.status === 'complete' && tab.url && tab.url.includes('labs.google')) {
    console.log('[nowFlow] Google Flow tab detected:', tabId);
    // 탭 업데이트 시 offscreen 준비
    ensureOffscreen().catch(() => {});
  }
});

console.log('[nowFlow] background.js v8.1 loaded');

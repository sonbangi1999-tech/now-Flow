// now Flow v8.2 - background.js
// Feature5: 씬당 CHAR×N + BG + FULL 3종 분리 생성 보장
// Fix: offscreen relay / START URL 체크 완화 / ensureOffscreen 강화

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

// ── content.js 주입 (__nowFlowLoaded guard) ──────────────────────
async function injectContent(tabId) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => window.__nowFlowLoaded === true
    });
    if (results && results[0] && results[0].result === true) {
      console.log('[nowFlow] content.js already loaded, skip inject');
      return { ok: true, skipped: true };
    }
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

// ── Feature5: 씬 배열 검증 – 각 씬에 BG·FULL 보장 ───────────────
// scenes 배열을 받아 characters 가 빈 경우도 BG+FULL 이 생성되도록
// content.js buildTasks() 와 동일한 규칙으로 총 에셋 수 계산
function validateScenes(scenes) {
  if (!Array.isArray(scenes)) return [];
  return scenes.map(scene => ({
    ...scene,
    // characters 없으면 빈 배열 보장 → BG+FULL 2개는 항상 생성
    characters: Array.isArray(scene.characters) ? scene.characters : []
  }));
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

  // ── OFFSCREEN_DOWNLOAD ──
  if (action === 'OFFSCREEN_DOWNLOAD' || action === 'offscreen_download') {
    if (sender && sender.url && sender.url.includes('offscreen.html')) {
      return false;
    }
    ensureOffscreen().then(() => {
      chrome.runtime.sendMessage({
        ...msg,
        action: 'OFFSCREEN_DOWNLOAD',
        _fromBackground: true
      }).catch(e => console.error('[nowFlow] offscreen send error:', e.message));
    }).catch(e => console.error('[nowFlow] ensureOffscreen error:', e.message));
    sendResponse({ ok: true });
    return true;
  }

  // ── SAVE_RESULT: offscreen → sidepanel relay ──
  if (action === 'SAVE_RESULT') {
    chrome.runtime.sendMessage({ ...msg, _fromBackground: true }).catch(() => {});
    sendResponse({ ok: true });
    return true;
  }

  // ── START: Feature5 scenes 검증 후 content.js 주입 → 전달 ──
  if (action === 'START') {
    (async () => {
      try {
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
        // 주입 직후 대기
        await new Promise(r => setTimeout(r, 300));
        // Feature5: scenes 검증 적용
        const validatedMsg = {
          ...msg,
          scenes: validateScenes(msg.scenes || [])
        };
        await chrome.tabs.sendMessage(tab.id, validatedMsg);
        sendResponse({ ok: true });
      } catch (e) {
        sendResponse({ ok: false, error: e.message });
      }
    })();
    return true;
  }

  // ── PAUSE / RESUME / STOP / RESET ──
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
    ensureOffscreen().catch(() => {});
  }
});

console.log('[nowFlow] background.js v8.2 loaded');

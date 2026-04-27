// background.js – now Flow v8.0  Service Worker
// Fix1: chrome.scripting.executeScript + window.__nowFlowLoaded 중복 방지
// Fix2: 단방향 메시지 + .catch(()=>{}) 전처리

'use strict';

let offscreenCreated = false;
let flowTabId        = null;

/* ── offscreen document 생성 ─────────────────────── */
async function ensureOffscreen() {
  if (offscreenCreated) return;
  const existing = await chrome.offscreen.hasDocument().catch(() => false);
  if (existing) { offscreenCreated = true; return; }
  await chrome.offscreen.createDocument({
    url:    chrome.runtime.getURL('offscreen.html'),
    reasons: ['BLOBS'],
    justification: 'Blob download for Flow images'
  });
  offscreenCreated = true;
}

/* ── Flow 탭 찾기 / 열기 ─────────────────────────── */
async function getFlowTab() {
  if (flowTabId !== null) {
    try {
      const tab = await chrome.tabs.get(flowTabId);
      if (tab && tab.url && tab.url.includes('labs.google')) return tab;
    } catch (_) { flowTabId = null; }
  }
  const tabs = await chrome.tabs.query({ url: 'https://labs.google/*' });
  if (tabs.length > 0) { flowTabId = tabs[0].id; return tabs[0]; }
  // 새 탭 열기
  const newTab = await chrome.tabs.create({ url: 'https://labs.google/fx/tools/flow', active: true });
  flowTabId = newTab.id;
  await waitForTabReady(flowTabId);
  return newTab;
}

/* ── 탭 준비 대기 ────────────────────────────────── */
function waitForTabReady(tabId, timeout = 10000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Tab load timeout')), timeout);
    chrome.tabs.onUpdated.addListener(function listener(id, info) {
      if (id === tabId && info.status === 'complete') {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    });
  });
}

/* ── Fix1: content.js 주입 (중복 방지) ──────────── */
async function injectContentScript(tabId) {
  // __nowFlowLoaded 플래그로 이중 주입 방지
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => window.__nowFlowLoaded === true
  });
  if (results && results[0] && results[0].result === true) {
    console.log('[nowFlow BG] content.js already loaded – skip injection');
    return;
  }
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ['content.js']
  });
  console.log('[nowFlow BG] content.js injected');
}

/* ── 사이드패널에 브로드캐스트 ────────────────────── */
function broadcast(msg) {
  chrome.runtime.sendMessage(msg).catch(() => {});
}

/* ── 메시지 라우터 ───────────────────────────────── */
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    try {
      const tab = await getFlowTab();
      await injectContentScript(tab.id);

      if (msg.action === 'START' || msg.action === 'RESUME' ||
          msg.action === 'PAUSE' || msg.action === 'STOP' || msg.action === 'RESET') {
        chrome.tabs.sendMessage(tab.id, msg).catch(() => {});
        sendResponse({ ok: true });
        return;
      }

      if (msg.action === 'OFFSCREEN_DOWNLOAD') {
        await ensureOffscreen();
        chrome.runtime.sendMessage({ ...msg, target: 'offscreen' }).catch(() => {});
        sendResponse({ ok: true });
        return;
      }

      if (msg.action === 'SAVE_RESULT') {
        broadcast(msg);   // sidepanel로 전달
        sendResponse({ ok: true });
        return;
      }

      sendResponse({ ok: false, error: 'unknown action' });
    } catch (e) {
      console.error('[nowFlow BG] error:', e);
      sendResponse({ ok: false, error: e.message });
    }
  })();
  return true; // async response
});

/* ── 탭 변경 감지 → CONNECTED / DISCONNECTED ────── */
chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (!tab.url || !tab.url.includes('labs.google')) return;
  if (info.status === 'complete') {
    flowTabId = tabId;
    broadcast({ action: 'TAB_STATUS', status: 'CONNECTED' });
  }
});
chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === flowTabId) {
    flowTabId = null;
    broadcast({ action: 'TAB_STATUS', status: 'DISCONNECTED' });
  }
});

console.log('[nowFlow BG] Service Worker started v8.0');

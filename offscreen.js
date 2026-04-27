// offscreen.js – now Flow v8.0  Offscreen Document
// Blob 다운로드 처리 (click-free automatic save)

'use strict';

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.action !== 'OFFSCREEN_DOWNLOAD' && msg.action !== 'offscreen_download') return;

  (async () => {
    try {
      let blob;
      if (msg.bytes && Array.isArray(msg.bytes)) {
        blob = new Blob([new Uint8Array(msg.bytes)], { type: msg.mimeType || 'image/png' });
      } else if (msg.url) {
        // 방법1: fetch + credentials:'include' (세션 쿠키 포함 → 403 우회)
        let resp = await fetch(msg.url, { credentials: 'include' }).catch(() => null);
        if (!resp || !resp.ok) {
          // 방법2: chrome.downloads 직접 (브라우저 세션 그대로 사용)
          const directId = await new Promise((resolve, reject) => {
            chrome.downloads.download(
              { url: msg.url, filename: msg.filename || `nowflow_${Date.now()}.png`,
                saveAs: false, conflictAction: 'uniquify' },
              (id) => {
                if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
                else resolve(id);
              }
            );
          });
          await waitForDownload(directId);
          chrome.runtime.sendMessage({
            action: 'SAVE_RESULT', success: true,
            filename: msg.filename || '', downloadId: directId
          }).catch(() => {});
          sendResponse({ ok: true, filename: msg.filename });
          return;
        }
        blob = await resp.blob();
      } else {
        throw new Error('bytes 또는 url 이 없습니다');
      }

      const objUrl   = URL.createObjectURL(blob);
      const filename = msg.filename || `nowflow_${Date.now()}.png`;

      const downloadId = await new Promise((resolve, reject) => {
        chrome.downloads.download(
          { url: objUrl, filename, saveAs: false, conflictAction: 'uniquify' },
          (id) => {
            if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
            else resolve(id);
          }
        );
      });

      await waitForDownload(downloadId);
      URL.revokeObjectURL(objUrl);

      chrome.runtime.sendMessage({
        action: 'SAVE_RESULT', success: true, filename, downloadId
      }).catch(() => {});

      sendResponse({ ok: true, filename });
    } catch (e) {
      console.error('[nowFlow offscreen] download error:', e);
      chrome.runtime.sendMessage({
        action: 'SAVE_RESULT', success: false, error: e.message, filename: msg.filename || ''
      }).catch(() => {});
      sendResponse({ ok: false, error: e.message });
    }
  })();

  return true;
});

function waitForDownload(downloadId, timeout = 60000) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, timeout);
    const listener = (delta) => {
      if (delta.id !== downloadId) return;
      if (delta.state && (delta.state.current === 'complete' || delta.state.current === 'interrupted')) {
        clearTimeout(timer);
        chrome.downloads.onChanged.removeListener(listener);
        resolve(delta.state.current);
      }
    };
    chrome.downloads.onChanged.addListener(listener);
  });
}

console.log('[nowFlow offscreen] ready');

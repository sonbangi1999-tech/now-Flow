// offscreen.js – now Flow v8.0  Offscreen Document
// Blob 다운로드 처리 (click-free automatic save)
// FIX-403: fetch+credentials → chrome.downloads 직접 폴백

'use strict';

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.action !== 'OFFSCREEN_DOWNLOAD' && msg.action !== 'offscreen_download') return;

  (async () => {
    try {
      let blob;
      const filename = msg.filename || `nowflow_${Date.now()}.png`;

      if (msg.bytes && Array.isArray(msg.bytes)) {
        // content.js 에서 이미 bytes로 변환해서 전달한 경우
        blob = new Blob([new Uint8Array(msg.bytes)], { type: msg.mimeType || 'image/png' });

      } else if (msg.url) {
        // FIX-403: fetch + credentials:'include' 우선 시도
        let resp = null;
        try {
          resp = await fetch(msg.url, { credentials: 'include' });
        } catch (_) { resp = null; }

        if (resp && resp.ok) {
          blob = await resp.blob();
        } else {
          // 폴백: chrome.downloads.download 직접 사용 (브라우저 세션 활용)
          const directId = await new Promise((resolve, reject) => {
            chrome.downloads.download(
              { url: msg.url, filename, saveAs: false, conflictAction: 'uniquify' },
              (id) => {
                if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
                else resolve(id);
              }
            );
          });
          await waitForDownload(directId);
          chrome.runtime.sendMessage({ action: 'SAVE_RESULT', success: true, filename, downloadId: directId }).catch(() => {});
          sendResponse({ ok: true, filename });
          return;
        }
      } else {
        throw new Error('bytes 또는 url 이 없습니다');
      }

      // Blob → objectURL → chrome.downloads
      const objUrl = URL.createObjectURL(blob);
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

      chrome.runtime.sendMessage({ action: 'SAVE_RESULT', success: true, filename, downloadId }).catch(() => {});
      sendResponse({ ok: true, filename });

    } catch (e) {
      console.error('[nowFlow offscreen] download error:', e);
      chrome.runtime.sendMessage({ action: 'SAVE_RESULT', success: false, error: e.message, filename: msg.filename || '' }).catch(() => {});
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

console.log('[nowFlow offscreen] ready v8.0');

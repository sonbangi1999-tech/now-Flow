// now Flow v8.1 - offscreen.js
// Fix: _fromBackground 플래그로 무한루프 방지 / SAVE_RESULT relay 제거

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const action = msg.action || msg.type;

  // offscreen이 처리할 메시지만 수신 (background에서 온 OFFSCREEN_DOWNLOAD)
  if (action !== 'OFFSCREEN_DOWNLOAD' && action !== 'offscreen_download') return false;

  // _fromBackground 플래그가 없으면 무시 (무한루프 방지)
  if (!msg._fromBackground) return false;

  handleDownload(msg).then(result => {
    // SAVE_RESULT를 background로 전달 (background가 sidepanel에 relay)
    chrome.runtime.sendMessage({
      action: 'SAVE_RESULT',
      ok: result.ok,
      filename: result.filename,
      error: result.error || null,
      dotId: msg.dotId || null,
      sceneIndex: msg.sceneIndex != null ? msg.sceneIndex : null
    }).catch(() => {});
    sendResponse(result);
  }).catch(e => {
    chrome.runtime.sendMessage({
      action: 'SAVE_RESULT',
      ok: false,
      error: e.message,
      dotId: msg.dotId || null
    }).catch(() => {});
    sendResponse({ ok: false, error: e.message });
  });

  return true;
});

async function handleDownload(msg) {
  const filename = sanitizeFilename(msg.filename || `nowflow_${Date.now()}.png`);

  // 방법1: bytes 배열로 Blob 생성 (canvas 추출 경로)
  if (msg.bytes && msg.bytes.length > 0) {
    try {
      const blob = new Blob([new Uint8Array(msg.bytes)], { type: 'image/png' });
      const blobUrl = URL.createObjectURL(blob);
      const dlId = await startDownload(blobUrl, filename);
      await waitForDownload(dlId);
      URL.revokeObjectURL(blobUrl);
      return { ok: true, filename };
    } catch (e) {
      console.warn('[nowFlow offscreen] bytes download failed:', e.message);
    }
  }

  // 방법2: URL fetch with credentials (쿠키 포함, 403 우회)
  if (msg.url) {
    try {
      const res = await fetch(msg.url, {
        credentials: 'include',
        cache: 'no-store',
        mode: 'cors'
      });
      if (res.ok) {
        const buf = await res.arrayBuffer();
        const blob = new Blob([buf], { type: res.headers.get('content-type') || 'image/png' });
        const blobUrl = URL.createObjectURL(blob);
        const dlId = await startDownload(blobUrl, filename);
        await waitForDownload(dlId);
        URL.revokeObjectURL(blobUrl);
        return { ok: true, filename };
      }
      console.warn('[nowFlow offscreen] fetch response not ok:', res.status);
    } catch (e) {
      console.warn('[nowFlow offscreen] fetch download failed:', e.message);
    }

    // 방법3: chrome.downloads 직접 다운로드 (브라우저 세션 쿠키 활용)
    try {
      const dlId = await startDownload(msg.url, filename);
      await waitForDownload(dlId);
      return { ok: true, filename };
    } catch (e) {
      console.error('[nowFlow offscreen] direct download failed:', e.message);
      throw e;
    }
  }

  throw new Error('No bytes or URL provided');
}

function startDownload(url, filename) {
  return new Promise((resolve, reject) => {
    chrome.downloads.download(
      { url, filename, conflictAction: 'uniquify', saveAs: false },
      dlId => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(dlId);
        }
      }
    );
  });
}

function waitForDownload(dlId) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      chrome.downloads.onChanged.removeListener(listener);
      resolve(); // timeout 시 그냥 진행
    }, 30000);

    function listener(delta) {
      if (delta.id !== dlId) return;
      if (delta.state) {
        if (delta.state.current === 'complete') {
          clearTimeout(timeout);
          chrome.downloads.onChanged.removeListener(listener);
          resolve();
        } else if (delta.state.current === 'interrupted') {
          clearTimeout(timeout);
          chrome.downloads.onChanged.removeListener(listener);
          reject(new Error('Download interrupted'));
        }
      }
    }

    chrome.downloads.onChanged.addListener(listener);
  });
}

function sanitizeFilename(name) {
  // 폴더 구분자(/)는 유지, 나머지 특수문자만 제거
  return name.replace(/[<>:"|?*\\]/g, '_');
}

// now Flow v8.1 - content.js
// Fix1: __nowFlowLoaded guard | Fix3: dot IDs | Fix4: auto char assign
// Fix5: CHAR/BG/FULL assets | Fix6: matchAll+Set dedup | Fix8: prompt extract
// Fix11: zero-padded filenames | Fix12: verification
// Fix403: crossOrigin 설정 + 다중 img 탐색 + blob URL 직접 처리

(function () {
  'use strict';
  // Fix1: 중복 로드 방지
  if (window.__nowFlowLoaded) return;
  window.__nowFlowLoaded = true;
  console.log('[nowFlow] content.js v8.1 loaded');

  // ── 기본 설정 ────────────────────────────────────────────────────
  const DEFAULT = {
    model: 'imagen-3',
    ratio: '16:9',
    count: 1,
    concurrency: 1,
    retries: 2,
    delay: 3000,
    autoDownload: true,
    prefix: 'TF_',
    folder: 'Google_Flow_Saved',
    lang: 'ko'
  };

  let cfg = { ...DEFAULT };
  let isRunning = false;
  let isPaused = false;
  let shouldStop = false;

  // ── 메시지 수신 ──────────────────────────────────────────────────
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    const action = msg.action || msg.type;

    if (action === 'START') {
      if (isRunning) { sendResponse({ ok: false, error: 'Already running' }); return; }
      cfg = Object.assign({}, DEFAULT, msg.settings || {});
      isRunning = true; isPaused = false; shouldStop = false;
      runScenes(msg.scenes || []).finally(() => { isRunning = false; });
      sendResponse({ ok: true });
      return true;
    }
    if (action === 'PAUSE')  { isPaused = true;  sendResponse({ ok: true }); return; }
    if (action === 'RESUME') { isPaused = false; sendResponse({ ok: true }); return; }
    if (action === 'STOP')   { shouldStop = true; isPaused = false; sendResponse({ ok: true }); return; }
    if (action === 'RESET')  {
      isRunning = false; isPaused = false; shouldStop = false;
      sendResponse({ ok: true }); return;
    }
  });

  // ── 씬 실행 루프 ────────────────────────────────────────────────
  async function runScenes(scenes) {
    notify('START', { total: countTotalAssets(scenes) });

    for (let si = 0; si < scenes.length; si++) {
      if (shouldStop) break;
      const scene = scenes[si];
      notify('SCENE_START', { sceneIndex: si, sceneName: scene.name });

      const tasks = buildTasks(scene, si);
      for (const task of tasks) {
        if (shouldStop) break;
        while (isPaused && !shouldStop) await sleep(500);
        await runTask(task, si);
      }

      notify('SCENE_DONE', { sceneIndex: si });
    }

    notify('ALL_DONE', {});
  }

  // ── 태스크 빌드 (Fix5: CHAR×N + BG + FULL) ─────────────────────
  function buildTasks(scene, sceneIndex) {
    const tasks = [];
    const chars = scene.characters || [];
    for (const char of chars) {
      tasks.push({ type: 'CHAR', charName: char, scene, sceneIndex });
    }
    tasks.push({ type: 'BG', charName: null, scene, sceneIndex });
    tasks.push({ type: 'FULL', charName: null, scene, sceneIndex });
    return tasks;
  }

  function countTotalAssets(scenes) {
    return scenes.reduce((sum, s) => sum + (s.characters || []).length + 2, 0);
  }

  // ── 단일 태스크 실행 ─────────────────────────────────────────────
  async function runTask(task, si) {
    const { type, charName, scene } = task;
    const dotKey = type === 'CHAR'
      ? `sdot-${si}-char-${charName}`
      : `sdot-${si}-${type.toLowerCase()}`;

    notify('DOT_UPDATE', { dotId: dotKey, status: 'running' });

    const prompt = buildPrompt(task);
    let success = false;
    let lastError = '';

    for (let attempt = 0; attempt <= cfg.retries; attempt++) {
      if (shouldStop) break;
      try {
        await inputPrompt(prompt);
        await sleep(500);
        await clickGenerate();
        const imgSrc = await waitForNewImage(cfg.delay * 3);
        if (imgSrc) {
          const fname = buildFilename(si, type, charName, cfg.prefix);
          if (cfg.autoDownload) {
            await downloadImage(imgSrc, fname);
          }
          notify('SAVE_RESULT', {
            dotId: dotKey,
            sceneIndex: si,
            type,
            charName,
            filename: fname,
            ok: true
          });
          success = true;
          break;
        }
      } catch (e) {
        lastError = e.message;
        console.error(`[nowFlow] task error (attempt ${attempt + 1}):`, e);
        if (attempt < cfg.retries) await sleep(cfg.delay);
      }
    }

    if (!success) {
      notify('SAVE_RESULT', {
        dotId: dotKey,
        sceneIndex: si,
        type,
        charName,
        ok: false,
        error: lastError || 'Failed after retries'
      });
      notify('DOT_UPDATE', { dotId: dotKey, status: 'error' });
    } else {
      notify('DOT_UPDATE', { dotId: dotKey, status: 'done' });
    }
  }

  // ── 프롬프트 빌드 (Fix8) ──────────────────────────────────────────
  function buildPrompt(task) {
    const { type, charName, scene } = task;
    const raw = extractPromptText(scene.prompt || '');

    if (type === 'CHAR') {
      return cfg.lang === 'ko'
        ? `${raw}\n캐릭터: ${charName}, 전신 인물 중심, 배경 단순화`
        : `${raw}\nCharacter: ${charName}, full body, simplified background`;
    } else if (type === 'BG') {
      return cfg.lang === 'ko'
        ? `${raw}\n배경만, 인물 없음, 환경/공간 강조`
        : `${raw}\nBackground only, no characters, environment focus`;
    } else {
      return cfg.lang === 'ko'
        ? `${raw}\n전체 씬, 모든 캐릭터와 배경 포함`
        : `${raw}\nFull scene, all characters and background included`;
    }
  }

  function extractPromptText(text) {
    const m = text.match(/(?:프롬프트|Prompt)\s*:\s*([\s\S]+)/i);
    return m ? m[1].trim() : text.trim();
  }

  // ── Google Flow UI 조작 ─────────────────────────────────────────
  async function inputPrompt(text) {
    const selectors = [
      'textarea[placeholder*="prompt" i]',
      'textarea[placeholder*="프롬프트"]',
      'div[contenteditable="true"][aria-label*="prompt" i]',
      'div[contenteditable="true"]',
      'textarea'
    ];
    let el = null;
    for (const sel of selectors) {
      el = document.querySelector(sel);
      if (el) break;
    }
    if (!el) throw new Error('Prompt input not found');

    el.focus();
    if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
      const nativeInputValueSetter =
        Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set ||
        Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
      if (nativeInputValueSetter) {
        nativeInputValueSetter.call(el, text);
      } else {
        el.value = text;
      }
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    } else {
      // contenteditable
      el.focus();
      document.execCommand('selectAll', false, null);
      document.execCommand('insertText', false, text);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }
    await sleep(300);
  }

  async function clickGenerate() {
    const btns = [...document.querySelectorAll('button')];
    const generateBtn = btns.find(b => {
      const t = (b.textContent || '').toLowerCase().trim();
      return t.includes('generate') || t.includes('생성') ||
             t.includes('create') || t.includes('만들기');
    });
    if (!generateBtn) throw new Error('Generate button not found');
    generateBtn.click();
    await sleep(500);
  }

  async function waitForNewImage(timeout = 15000) {
    const start = Date.now();
    // 현재 존재하는 이미지 src 스냅샷 (blob URL 포함)
    const before = new Set(
      [...document.querySelectorAll('img')]
        .map(i => i.src)
        .filter(s => s && s.length > 0)
    );

    return new Promise((resolve) => {
      const check = () => {
        const imgs = [...document.querySelectorAll('img')];
        for (const img of imgs) {
          const src = img.src;
          if (!src || before.has(src)) continue;
          // 새로운 이미지: http URL 또는 blob URL 모두 허용
          if (src.startsWith('http') || src.startsWith('blob:')) {
            observer.disconnect();
            clearTimeout(timer);
            resolve(src);
            return;
          }
        }
        if (Date.now() - start > timeout) {
          observer.disconnect();
          clearTimeout(timer);
          resolve(null);
        }
      };

      const observer = new MutationObserver(check);
      observer.observe(document.body, {
        childList: true, subtree: true,
        attributes: true, attributeFilter: ['src']
      });
      const timer = setTimeout(() => {
        observer.disconnect();
        resolve(null);
      }, timeout);
    });
  }

  // ── 이미지 다운로드 (Fix403: 4중 폴백) ──────────────────────────
  async function downloadImage(imgSrc, filename) {

    // 방법0: blob: URL인 경우 → fetch로 Blob 직접 읽기 (403 없음)
    if (imgSrc.startsWith('blob:')) {
      try {
        const res = await fetch(imgSrc);
        if (res.ok) {
          const buf = await res.arrayBuffer();
          const bytes = Array.from(new Uint8Array(buf));
          await chrome.runtime.sendMessage({
            action: 'OFFSCREEN_DOWNLOAD',
            bytes,
            filename,
            folder: cfg.folder
          });
          return;
        }
      } catch (e) {
        console.warn('[nowFlow] blob fetch failed:', e.message);
      }
    }

    // 방법1: canvas.toBlob() - crossOrigin 설정 후 재로드하여 픽셀 추출
    try {
      const bytes = await fetchViaCanvas(imgSrc);
      if (bytes && bytes.length > 0) {
        await chrome.runtime.sendMessage({
          action: 'OFFSCREEN_DOWNLOAD',
          bytes: Array.from(bytes),
          filename,
          folder: cfg.folder
        });
        return;
      }
    } catch (e) {
      console.warn('[nowFlow] canvas method failed:', e.message);
    }

    // 방법2: fetch with credentials (쿠키 포함, CORS)
    try {
      const res = await fetch(imgSrc, {
        credentials: 'include',
        cache: 'no-store',
        mode: 'cors'
      });
      if (res.ok) {
        const buf = await res.arrayBuffer();
        const bytes = Array.from(new Uint8Array(buf));
        await chrome.runtime.sendMessage({
          action: 'OFFSCREEN_DOWNLOAD',
          bytes,
          filename,
          folder: cfg.folder
        });
        return;
      }
    } catch (e) {
      console.warn('[nowFlow] fetch(cors) failed:', e.message);
    }

    // 방법3: fetch no-cors (헤더 없이 시도)
    try {
      const res = await fetch(imgSrc, { credentials: 'include', cache: 'no-store' });
      if (res.ok) {
        const buf = await res.arrayBuffer();
        const bytes = Array.from(new Uint8Array(buf));
        await chrome.runtime.sendMessage({
          action: 'OFFSCREEN_DOWNLOAD',
          bytes,
          filename,
          folder: cfg.folder
        });
        return;
      }
    } catch (e) {
      console.warn('[nowFlow] fetch(no-cors) failed:', e.message);
    }

    // 방법4: URL을 offscreen에 넘겨 chrome.downloads로 직접 다운로드
    await chrome.runtime.sendMessage({
      action: 'OFFSCREEN_DOWNLOAD',
      url: imgSrc,
      filename,
      folder: cfg.folder
    });
  }

  // Fix403: crossOrigin="anonymous" 설정 후 새 이미지 로드 → canvas 픽셀 추출
  function fetchViaCanvas(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = img.naturalWidth;
          canvas.height = img.naturalHeight;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0);
          canvas.toBlob(blob => {
            if (!blob) { reject(new Error('toBlob failed')); return; }
            blob.arrayBuffer()
              .then(buf => resolve(new Uint8Array(buf)))
              .catch(reject);
          }, 'image/png');
        } catch (e) {
          reject(e);
        }
      };
      img.onerror = () => reject(new Error('crossOrigin image load failed'));
      // cache-busting은 하지 않음 (쿼리스트링이 403 유발 가능)
      img.src = src;
    });
  }

  // ── 파일명 생성 (Fix11: 제로패딩) ───────────────────────────────
  function buildFilename(sceneIndex, type, charName, prefix) {
    const si = String(sceneIndex + 1).padStart(2, '0');
    const now = new Date();
    const hms = [
      String(now.getHours()).padStart(2, '0'),
      String(now.getMinutes()).padStart(2, '0'),
      String(now.getSeconds()).padStart(2, '0')
    ].join('');
    const dateStr = [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, '0'),
      String(now.getDate()).padStart(2, '0')
    ].join('');
    const safe = charName ? charName.replace(/[^a-zA-Z0-9가-힣]/g, '_') : '';
    const folder = cfg.folder || 'Google_Flow_Saved';
    if (type === 'CHAR' && safe) {
      return `${folder}/${dateStr}/Scene${si}_CHAR_${safe}_${prefix}${hms}.png`;
    } else {
      return `${folder}/${dateStr}/Scene${si}_${type}_${prefix}${hms}.png`;
    }
  }

  // ── 알림 전송 ────────────────────────────────────────────────────
  function notify(type, data) {
    chrome.runtime.sendMessage({ action: type, ...data }).catch(() => {});
  }

  // ── 유틸 ─────────────────────────────────────────────────────────
  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

})();

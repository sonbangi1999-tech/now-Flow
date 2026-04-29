// now Flow v8.2 - content.js
// Feature5: CHAR×N + BG + FULL 3종 분리 생성 (캐릭터 2명 → 파일 4개)
// Fix403: blob URL / crossOrigin canvas / fetch 4중 폴백
// Fix1: __nowFlowLoaded guard | Fix11: zero-padded filenames

(function () {
  'use strict';
  if (window.__nowFlowLoaded) return;
  window.__nowFlowLoaded = true;
  console.log('[nowFlow] content.js v8.2 loaded');

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
  let isPaused  = false;
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

      // Feature5: buildTasks 가 CHAR×N + BG + FULL 을 반드시 생성
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

  // ── Feature5: 태스크 빌드 ────────────────────────────────────────
  // 캐릭터가 N명이면: CHAR×N + BG(1) + FULL(1) = N+2 개
  // 캐릭터가 없으면: BG(1) + FULL(1) = 2 개
  function buildTasks(scene, sceneIndex) {
    const tasks = [];
    const chars = Array.isArray(scene.characters) ? scene.characters : [];

    // CHAR 태스크: 캐릭터별 크로마키 인물 단독 생성
    for (const char of chars) {
      tasks.push({ type: 'CHAR', charName: char, scene, sceneIndex });
    }
    // BG 태스크: 배경만 (인물 없음)
    tasks.push({ type: 'BG', charName: null, scene, sceneIndex });
    // FULL 태스크: 전체 합본 (모든 캐릭터 + 배경)
    tasks.push({ type: 'FULL', charName: null, scene, sceneIndex });

    return tasks;
  }

  // Feature5: 총 에셋 수 = Σ(캐릭터 수 + 2)
  function countTotalAssets(scenes) {
    return scenes.reduce((sum, s) => {
      const chars = Array.isArray(s.characters) ? s.characters : [];
      return sum + chars.length + 2;
    }, 0);
  }

  // ── 단일 태스크 실행 ─────────────────────────────────────────────
  async function runTask(task, si) {
    const { type, charName, scene } = task;
    // dot ID: CHAR → sdot-{si}-char-{name}, BG → sdot-{si}-bg, FULL → sdot-{si}-full
    const dotKey = type === 'CHAR'
      ? `sdot-${si}-char-${charName}`
      : `sdot-${si}-${type.toLowerCase()}`;

    notify('DOT_UPDATE', { dotId: dotKey, status: 'running' });

    const prompt = buildPrompt(task);
    let success  = false;
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
            dotId: dotKey, sceneIndex: si,
            type, charName, filename: fname, ok: true
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
        dotId: dotKey, sceneIndex: si,
        type, charName, ok: false,
        error: lastError || 'Failed after retries'
      });
      notify('DOT_UPDATE', { dotId: dotKey, status: 'error' });
    } else {
      notify('DOT_UPDATE', { dotId: dotKey, status: 'done' });
    }
  }

  // ── Feature5: 프롬프트 빌드 ──────────────────────────────────────
  // CHAR: 크로마키 인물 단독 | BG: 배경만 | FULL: 합본
  function buildPrompt(task) {
    const { type, charName, scene } = task;
    const raw = extractPromptText(scene.prompt || '');

    if (type === 'CHAR') {
      return cfg.lang === 'ko'
        ? `${raw}\n캐릭터: ${charName}, 전신 단독 인물, 크로마키 배경(단색), 배경 최소화`
        : `${raw}\nCharacter: ${charName}, full body solo, chroma key background, minimal background`;
    } else if (type === 'BG') {
      return cfg.lang === 'ko'
        ? `${raw}\n배경만, 인물 완전 없음, 환경·공간 강조`
        : `${raw}\nBackground only, no characters at all, environment and space focus`;
    } else { // FULL
      return cfg.lang === 'ko'
        ? `${raw}\n전체 씬 합본, 모든 캐릭터와 배경 포함`
        : `${raw}\nFull scene composite, all characters and background included`;
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
      const setter =
        Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set ||
        Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
      if (setter) setter.call(el, text); else el.value = text;
      el.dispatchEvent(new Event('input',  { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    } else {
      el.focus();
      document.execCommand('selectAll', false, null);
      document.execCommand('insertText', false, text);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }
    await sleep(300);
  }

  async function clickGenerate() {
    const btns = [...document.querySelectorAll('button')];
    const btn = btns.find(b => {
      const t = (b.textContent || '').toLowerCase().trim();
      return t.includes('generate') || t.includes('생성') ||
             t.includes('create')   || t.includes('만들기');
    });
    if (!btn) throw new Error('Generate button not found');
    btn.click();
    await sleep(500);
  }

  async function waitForNewImage(timeout = 15000) {
    const start  = Date.now();
    const before = new Set(
      [...document.querySelectorAll('img')]
        .map(i => i.src)
        .filter(Boolean)
    );

    return new Promise(resolve => {
      const check = () => {
        for (const img of document.querySelectorAll('img')) {
          const src = img.src;
          if (!src || before.has(src)) continue;
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
      const timer = setTimeout(() => { observer.disconnect(); resolve(null); }, timeout);
    });
  }

  // ── 이미지 다운로드 (4중 폴백, Fix403) ──────────────────────────
  async function downloadImage(imgSrc, filename) {
    // 방법0: blob: URL → fetch 직접
    if (imgSrc.startsWith('blob:')) {
      try {
        const res = await fetch(imgSrc);
        if (res.ok) {
          const bytes = Array.from(new Uint8Array(await res.arrayBuffer()));
          await sendDownload({ bytes, filename });
          return;
        }
      } catch (e) { console.warn('[nowFlow] blob fetch failed:', e.message); }
    }

    // 방법1: crossOrigin canvas
    try {
      const bytes = await fetchViaCanvas(imgSrc);
      if (bytes && bytes.length > 0) {
        await sendDownload({ bytes: Array.from(bytes), filename });
        return;
      }
    } catch (e) { console.warn('[nowFlow] canvas failed:', e.message); }

    // 방법2: fetch cors + credentials
    try {
      const res = await fetch(imgSrc, { credentials: 'include', cache: 'no-store', mode: 'cors' });
      if (res.ok) {
        const bytes = Array.from(new Uint8Array(await res.arrayBuffer()));
        await sendDownload({ bytes, filename });
        return;
      }
    } catch (e) { console.warn('[nowFlow] fetch cors failed:', e.message); }

    // 방법3: fetch no-cors
    try {
      const res = await fetch(imgSrc, { credentials: 'include', cache: 'no-store' });
      if (res.ok) {
        const bytes = Array.from(new Uint8Array(await res.arrayBuffer()));
        await sendDownload({ bytes, filename });
        return;
      }
    } catch (e) { console.warn('[nowFlow] fetch no-cors failed:', e.message); }

    // 방법4: URL 직접 전달 → offscreen chrome.downloads
    await sendDownload({ url: imgSrc, filename });
  }

  function sendDownload(payload) {
    return chrome.runtime.sendMessage({
      action: 'OFFSCREEN_DOWNLOAD',
      folder: cfg.folder,
      ...payload
    });
  }

  function fetchViaCanvas(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width  = img.naturalWidth;
          canvas.height = img.naturalHeight;
          canvas.getContext('2d').drawImage(img, 0, 0);
          canvas.toBlob(blob => {
            if (!blob) { reject(new Error('toBlob failed')); return; }
            blob.arrayBuffer().then(buf => resolve(new Uint8Array(buf))).catch(reject);
          }, 'image/png');
        } catch (e) { reject(e); }
      };
      img.onerror = () => reject(new Error('crossOrigin image load failed'));
      img.src = src;
    });
  }

  // ── 파일명 생성 (zero-padded) ────────────────────────────────────
  function buildFilename(sceneIndex, type, charName, prefix) {
    const si  = String(sceneIndex + 1).padStart(2, '0');
    const now = new Date();
    const hms = [now.getHours(), now.getMinutes(), now.getSeconds()]
      .map(v => String(v).padStart(2, '0')).join('');
    const date = [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, '0'),
      String(now.getDate()).padStart(2, '0')
    ].join('');
    const safe   = charName ? charName.replace(/[^a-zA-Z0-9가-힣]/g, '_') : '';
    const folder = cfg.folder || 'Google_Flow_Saved';
    return type === 'CHAR' && safe
      ? `${folder}/${date}/Scene${si}_CHAR_${safe}_${prefix}${hms}.png`
      : `${folder}/${date}/Scene${si}_${type}_${prefix}${hms}.png`;
  }

  // ── 알림 ─────────────────────────────────────────────────────────
  function notify(type, data) {
    chrome.runtime.sendMessage({ action: type, ...data }).catch(() => {});
  }

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

})();

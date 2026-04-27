// content.js – now Flow v8.0  Content Script
// Fix1:  window.__nowFlowLoaded 중복 주입 방지
// Fix3:  dot UI 업데이트 (sdot-{si}-char-{name}, sdot-{si}-bg, sdot-{si}-full)
// Fix5:  CHAR × chars.length + BG × 1 + FULL × 1
// Fix8:  '프롬프트:' / 'Prompt:' 이후 텍스트만 추출
// Fix11: 파일명 Scene01_CHAR_name_TF_HHMMSS.png (zero-padded)

'use strict';

if (window.__nowFlowLoaded) {
  console.log('[nowFlow] content.js already loaded – skip');
} else {
  window.__nowFlowLoaded = true;
  console.log('[nowFlow] content.js loaded v8.0');
  initContentScript();
}

function initContentScript() {

  /* ─── 상태 ─────────────────────────────────────── */
  let jobRunning = false;
  let jobPaused  = false;
  let abortCtrl  = null;

  /* ─── 기본 설정 ─────────────────────────────────── */
  const DEFAULT = {
    model: 'imagen-3', ratio: '16:9', count: 1,
    concurrency: 1, retries: 2, delay: 3000,
    autoDownload: true, prefix: 'TF_',
    folder: 'Google_Flow_Saved', lang: 'ko'
  };

  /* ─── 메시지 수신 ───────────────────────────────── */
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    switch (msg.action) {
      case 'START':
        if (!jobRunning) startJob(msg.payload || {});
        break;
      case 'PAUSE':
        jobPaused = true;
        notify('PAUSED', '일시정지됨');
        break;
      case 'RESUME':
        jobPaused = false;
        notify('RESUMED', '재개됨');
        break;
      case 'STOP':
        jobRunning = false; jobPaused = false;
        if (abortCtrl) abortCtrl.abort();
        notify('STOPPED', '중지됨');
        break;
      case 'RESET':
        jobRunning = false; jobPaused = false;
        if (abortCtrl) abortCtrl.abort();
        break;
    }
    sendResponse({ ok: true });
    return true;
  });

  /* ─── 메인 작업 ─────────────────────────────────── */
  async function startJob(payload) {
    jobRunning = true;
    jobPaused  = false;
    abortCtrl  = new AbortController();
    const signal = abortCtrl.signal;
    const cfg    = { ...DEFAULT, ...(payload.settings || {}) };
    const scenes = payload.scenes || [];

    if (scenes.length === 0) {
      notify('ERROR', '씬이 없습니다'); jobRunning = false; return;
    }
    notify('STARTED', `총 ${scenes.length}개 씬 시작`);

    for (let si = 0; si < scenes.length; si++) {
      if (signal.aborted || !jobRunning) break;
      while (jobPaused && jobRunning && !signal.aborted) await sleep(500);
      if (signal.aborted || !jobRunning) break;

      const scene = scenes[si];
      notify('SCENE_START', `씬 ${si + 1}/${scenes.length} 시작`, { sceneIndex: si });

      try {
        await processScene(scene, si, cfg, signal);
      } catch (e) {
        console.error(`[nowFlow] Scene ${si + 1} error:`, e);
        notify('ERROR', `씬 ${si + 1} 오류: ${e.message}`, { sceneIndex: si });
      }
      await sleep(cfg.delay);
    }

    notify('DONE', '모든 씬 완료');
    jobRunning = false;
  }

  /* ─── 씬 처리 (Fix5: CHAR×N + BG + FULL) ────────── */
  async function processScene(scene, si, cfg, signal) {
    const { prompt, characters = [], bgPrompt = '' } = scene;

    const tasks = [];
    // CHAR: 캐릭터마다 1장
    for (const charName of characters) {
      tasks.push({ type: 'CHAR', charName, prompt: buildCharPrompt(charName, prompt, cfg) });
    }
    // BG: 1장
    tasks.push({ type: 'BG', charName: '', prompt: buildBgPrompt(bgPrompt || prompt, cfg) });
    // FULL: 1장
    tasks.push({ type: 'FULL', charName: characters.join('+'), prompt: buildFullPrompt(characters, prompt, cfg) });

    for (const task of tasks) {
      if (signal.aborted || !jobRunning) return;
      while (jobPaused && jobRunning) await sleep(500);

      // Fix3: dot ID
      const dotId = task.type === 'CHAR'
        ? `sdot-${si}-char-${task.charName}`
        : `sdot-${si}-${task.type.toLowerCase()}`;

      notify('DOT_UPDATE', '', { dotId, status: 'working' });

      let success = false;
      for (let attempt = 0; attempt <= cfg.retries && !signal.aborted; attempt++) {
        try {
          const filename = buildFilename(si, task.type, task.charName, cfg);
          await injectPromptAndGenerate(task.prompt, cfg);
          const imgSrc = await captureNewImage(signal);
          if (imgSrc) {
            await downloadImage(imgSrc, filename, cfg);
            notify('DOT_UPDATE', '', { dotId, status: 'done' });
            notify('SAVE_RESULT', filename, {
              sceneIndex: si, type: task.type,
              charName: task.charName, filename, success: true
            });
            success = true;
            break;
          }
        } catch (e) {
          console.warn(`[nowFlow] attempt ${attempt + 1} failed:`, e.message);
          if (attempt < cfg.retries) await sleep(2000);
        }
      }
      if (!success) {
        notify('DOT_UPDATE', '', { dotId, status: 'error' });
        console.error(`[nowFlow] FAILED: ${task.type} scene ${si + 1} char=${task.charName}`);
      }
      await sleep(cfg.delay);
    }
  }

  /* ─── Fix8: 프롬프트 텍스트 추출 ─────────────────── */
  function extractPromptText(raw) {
    const m = raw.match(/(?:프롬프트|Prompt)\s*:\s*([\s\S]+)/i);
    return m ? m[1].trim() : raw.trim();
  }

  function buildCharPrompt(charName, raw, cfg) {
    const base = extractPromptText(raw);
    return cfg.lang === 'ko'
      ? `캐릭터 단독 이미지, ${charName}: ${base}`
      : `Character only, ${charName}: ${base}`;
  }

  function buildBgPrompt(raw, cfg) {
    const base = extractPromptText(raw);
    return cfg.lang === 'ko'
      ? `배경만, 인물 없음: ${base}`
      : `Background only, no people: ${base}`;
  }

  function buildFullPrompt(characters, raw, cfg) {
    const base  = extractPromptText(raw);
    const chars = characters.join(', ');
    return cfg.lang === 'ko'
      ? `전체 장면 [${chars}]: ${base}`
      : `Full scene [${chars}]: ${base}`;
  }

  /* ─── Fix11: 파일명 ──────────────────────────────── */
  function buildFilename(si, type, charName, cfg) {
    const pad  = String(si + 1).padStart(2, '0');
    const now  = new Date();
    const date = now.toISOString().slice(0, 10).replace(/-/g, '');
    const time = now.toTimeString().slice(0, 8).replace(/:/g, '');
    const safe = (charName || 'none').replace(/[^a-zA-Z0-9가-힣_-]/g, '_');
    return `${cfg.folder}/${date}/Scene${pad}_${type}_${safe}_${cfg.prefix}${time}.png`;
  }

  /* ─── 프롬프트 주입 + 생성 버튼 클릭 ─────────────── */
  async function injectPromptAndGenerate(prompt, cfg) {
    const editor =
      document.querySelector('[contenteditable="true"]') ||
      document.querySelector('textarea[placeholder]') ||
      document.querySelector('textarea');

    if (!editor) throw new Error('프롬프트 입력 영역을 찾을 수 없습니다');

    editor.focus();

    if (editor.tagName === 'TEXTAREA' || editor.tagName === 'INPUT') {
      const nativeSetter =
        Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set ||
        Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
      if (nativeSetter) nativeSetter.call(editor, prompt);
      editor.dispatchEvent(new Event('input',  { bubbles: true }));
      editor.dispatchEvent(new Event('change', { bubbles: true }));
    } else {
      editor.textContent = '';
      document.execCommand('insertText', false, prompt);
    }

    await sleep(600);

    const btn = findGenerateButton();
    if (!btn) throw new Error('생성 버튼을 찾을 수 없습니다');
    btn.click();
  }

  function findGenerateButton() {
    const selectors = [
      'button[aria-label*="Generate"]',
      'button[aria-label*="생성"]',
      'button[data-testid*="generate"]',
      'button[data-testid*="submit"]'
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el && !el.disabled) return el;
    }
    return Array.from(document.querySelectorAll('button')).find(b =>
      /generate|생성|submit/i.test(b.textContent) && !b.disabled
    ) || null;
  }

  /* ─── 새 이미지 감지 (MutationObserver) ──────────── */
  function captureNewImage(signal, timeout = 30000) {
    return new Promise((resolve, reject) => {
      const before = new Set(
        Array.from(document.querySelectorAll('img[src]')).map(i => i.src)
      );
      const timer = setTimeout(() => {
        observer.disconnect();
        reject(new Error('이미지 생성 타임아웃'));
      }, timeout);

      const observer = new MutationObserver(() => {
        if (signal.aborted) {
          clearTimeout(timer); observer.disconnect(); resolve(null); return;
        }
        for (const img of document.querySelectorAll('img[src]')) {
          if (!before.has(img.src) && img.src.startsWith('http') &&
              img.complete && img.naturalWidth > 100) {
            clearTimeout(timer); observer.disconnect(); resolve(img.src); return;
          }
        }
      });
      observer.observe(document.body, {
        childList: true, subtree: true,
        attributes: true, attributeFilter: ['src']
      });
    });
  }

  /* ─── 이미지 다운로드 ────────────────────────────── */
  async function downloadImage(imgSrc, filename, cfg) {
    if (!cfg.autoDownload) return;
    const resp  = await fetch(imgSrc);
    const buf   = await resp.arrayBuffer();
    const bytes = Array.from(new Uint8Array(buf));
    chrome.runtime.sendMessage({
      action: 'OFFSCREEN_DOWNLOAD',
      bytes, filename, mimeType: 'image/png'
    }).catch(() => {});
  }

  /* ─── 알림 헬퍼 ─────────────────────────────────── */
  function notify(action, message, extra = {}) {
    chrome.runtime.sendMessage({ action, message, ...extra }).catch(() => {});
  }

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

} // end initContentScript

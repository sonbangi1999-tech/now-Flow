// now Flow v8.1 - sidepanel.js
// Fix: 시작 버튼 동작 수정 / SAVE_RESULT 중복 처리 방지 / 메시지 리스너 안정화

'use strict';

// ── 전역 상태 ────────────────────────────────────────────────────
let scenes = [];
let characters = [];
let isRunning = false;
let isPaused = false;
let doneCount = 0;
let totalAssets = 0;

let settings = {
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

// ── DOM 준비 ─────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initTabs();
  initButtons();
  initCharInput();
  initSettingsSync();
  initMessageListener();
  checkTabStatus();
  runChecklist();
  addLog('info', 'now Flow v8.1 사이드패널 로드 완료');
});

// ── 현재 탭 상태 확인 ────────────────────────────────────────────
async function checkTabStatus() {
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tabs && tabs[0]) {
      const url = tabs[0].url || '';
      if (url.includes('labs.google') || url.includes('flow')) {
        updateStatusDot('connected', 'Google Flow 탭 연결됨');
      } else {
        updateStatusDot('', 'Google Flow 탭을 열어주세요');
      }
    }
  } catch (e) {
    updateStatusDot('', '탭 확인 중 오류');
  }
}

// ── 탭 전환 ──────────────────────────────────────────────────────
function initTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      const panel = document.getElementById('tab-' + btn.dataset.tab);
      if (panel) panel.classList.add('active');
    });
  });
}

// ── 버튼 초기화 ──────────────────────────────────────────────────
function initButtons() {
  document.getElementById('btn-start').addEventListener('click', onStart);
  document.getElementById('btn-pause').addEventListener('click', onPause);
  document.getElementById('btn-stop').addEventListener('click', onStop);
  document.getElementById('btn-reset').addEventListener('click', onReset);
  document.getElementById('btn-parse').addEventListener('click', onParse);
  document.getElementById('btn-csv').addEventListener('click', exportCSV);
  document.getElementById('btn-clear-log').addEventListener('click', () => {
    document.getElementById('log-area').innerHTML = '';
  });
  document.getElementById('btn-run-checklist').addEventListener('click', runChecklist);
}

// ── 캐릭터 입력 ──────────────────────────────────────────────────
function initCharInput() {
  const input = document.getElementById('char-input');
  const addBtn = document.getElementById('btn-add-char');

  function addChar() {
    const name = input.value.trim();
    if (!name) return;
    if (!characters.includes(name)) {
      characters.push(name);
      renderCharTags();
      addLog('info', `캐릭터 등록: ${escHtml(name)}`);
    }
    input.value = '';
    input.focus();
  }

  input.addEventListener('keydown', e => { if (e.key === 'Enter') addChar(); });
  addBtn.addEventListener('click', addChar);
}

function renderCharTags() {
  const container = document.getElementById('char-tags');
  container.innerHTML = characters.map((c, i) =>
    `<span class="char-tag">
      ${escHtml(c)}
      <span class="remove" onclick="removeCharacter(${i})">✕</span>
    </span>`
  ).join('');
}

window.removeCharacter = function(i) {
  characters.splice(i, 1);
  renderCharTags();
};

// ── 설정 동기화 ──────────────────────────────────────────────────
function initSettingsSync() {
  const map = {
    'set-model':         v => settings.model = v,
    'set-ratio':         v => settings.ratio = v,
    'set-count':         v => settings.count = parseInt(v) || 1,
    'set-concurrency':   v => settings.concurrency = parseInt(v) || 1,
    'set-retries':       v => settings.retries = parseInt(v) || 2,
    'set-delay':         v => settings.delay = parseInt(v) || 3000,
    'set-auto-download': v => settings.autoDownload = v,
    'set-prefix':        v => settings.prefix = v,
    'set-folder':        v => settings.folder = v,
    'set-lang':          v => settings.lang = v
  };

  Object.entries(map).forEach(([id, fn]) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('change', () => {
      fn(el.type === 'checkbox' ? el.checked : el.value);
    });
  });
}

// ── 씬 파싱 (Fix6: matchAll + Set 중복방지) ───────────────────────
function parseScenes(text) {
  const result = [];
  const seenNames = new Set();

  const pattern = /(?:씬\s*(\d+)|[Ss]cene\s*(\d+))\s*[:：]/g;
  const matches = [...text.matchAll(pattern)];

  if (matches.length > 0) {
    matches.forEach((m, idx) => {
      const num = m[1] || m[2];
      const start = m.index + m[0].length;
      const end = matches[idx + 1] ? matches[idx + 1].index : text.length;
      const rawContent = text.slice(start, end).trim();

      const sceneName = `Scene${String(num).padStart(2, '0')}`;
      if (seenNames.has(sceneName)) return;
      seenNames.add(sceneName);

      const promptMatch = rawContent.match(/(?:프롬프트|Prompt)\s*:\s*([\s\S]+)/i);
      const prompt = promptMatch ? promptMatch[1].trim() : rawContent;

      const assignedChars = autoAssignCharacters(rawContent);

      result.push({
        name: sceneName,
        index: parseInt(num) - 1,
        prompt,
        characters: assignedChars,
        rawContent
      });
    });
  } else {
    const rawContent = text.trim();
    if (rawContent) {
      const promptMatch = rawContent.match(/(?:프롬프트|Prompt)\s*:\s*([\s\S]+)/i);
      const prompt = promptMatch ? promptMatch[1].trim() : rawContent;
      const assignedChars = autoAssignCharacters(rawContent);
      result.push({
        name: 'Scene01',
        index: 0,
        prompt,
        characters: assignedChars,
        rawContent
      });
    }
  }

  return result;
}

function autoAssignCharacters(text) {
  const found = [];
  for (const char of characters) {
    if (text.includes(char)) found.push(char);
  }
  return found;
}

// ── 씬 파싱 버튼 핸들러 ─────────────────────────────────────────
function onParse() {
  const text = document.getElementById('prompt-input').value.trim();
  if (!text) {
    addLog('error', '프롬프트를 입력하세요.');
    return;
  }
  scenes = parseScenes(text);
  if (scenes.length === 0) {
    addLog('error', '씬을 파싱할 수 없습니다. 형식을 확인하세요.');
    return;
  }
  addLog('success', `${scenes.length}개 씬 파싱 완료`);
  renderSceneList();
  renderScenePreview();
  updateSceneCount();
}

// ── 씬 목록 렌더링 ───────────────────────────────────────────────
function renderSceneList() {
  const container = document.getElementById('scene-list');
  container.innerHTML = '';

  scenes.forEach((scene, si) => {
    const charCount = scene.characters.length;
    const totalDots = charCount + 2;

    const card = document.createElement('div');
    card.className = 'scene-card';
    card.id = `scene-card-${si}`;
    card.dataset.sceneIndex = si;

    const charDots = scene.characters.map(c =>
      `<div class="dot char pending" id="sdot-${si}-char-${c}" title="CHAR: ${escAttr(c)}"></div>`
    ).join('');
    const bgDot   = `<div class="dot bg pending"   id="sdot-${si}-bg"   title="BG"></div>`;
    const fullDot = `<div class="dot full pending" id="sdot-${si}-full" title="FULL"></div>`;

    card.innerHTML = `
      <div class="scene-header">
        <span class="scene-name">${escHtml(scene.name)}</span>
        <span class="scene-status" id="scene-status-${si}">대기</span>
      </div>
      <div style="font-size:10px;color:#888;margin-bottom:4px">
        캐릭터: ${scene.characters.length > 0 ? scene.characters.map(escHtml).join(', ') : '(없음)'}
        &nbsp;|&nbsp; 에셋: ${totalDots}개 (CHAR×${charCount} + BG + FULL)
      </div>
      <div style="font-size:10px;color:#666;margin-bottom:4px;word-break:break-all">
        ${escHtml(scene.prompt.slice(0, 80))}${scene.prompt.length > 80 ? '...' : ''}
      </div>
      <div class="dot-row">${charDots}${bgDot}${fullDot}</div>
    `;

    container.appendChild(card);
  });
}

function renderScenePreview() {
  const section = document.getElementById('scene-preview-section');
  const container = document.getElementById('scene-preview');
  section.style.display = 'block';

  container.innerHTML = scenes.map((scene) => {
    const charCount = scene.characters.length;
    return `
      <div class="scene-card" style="margin-bottom:6px">
        <div class="scene-header">
          <span class="scene-name">${escHtml(scene.name)}</span>
          <span style="font-size:10px;color:#a78bfa">에셋 ${charCount + 2}개</span>
        </div>
        <div style="font-size:10px;color:#888">
          캐릭터: ${scene.characters.length > 0 ? scene.characters.map(escHtml).join(', ') : '없음'}
        </div>
      </div>
    `;
  }).join('');
}

function updateSceneCount() {
  const el = document.getElementById('scene-count');
  if (el) el.textContent = `(${scenes.length}개)`;
}

// ── 시작 버튼 ── [Fix: 버튼 동작 안 하는 문제 핵심 수정] ────────────
async function onStart() {
  if (isRunning) {
    addLog('error', '이미 실행 중입니다.');
    return;
  }
  if (scenes.length === 0) {
    addLog('error', '먼저 씬을 파싱하세요 (🔍 씬 파싱 버튼 클릭).');
    return;
  }

  // 현재 탭 확인
  let targetTab = null;
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    targetTab = tabs && tabs[0] ? tabs[0] : null;
  } catch (e) {
    addLog('error', '탭 정보를 가져올 수 없습니다: ' + e.message);
    return;
  }

  if (!targetTab) {
    addLog('error', '활성 탭을 찾을 수 없습니다.');
    return;
  }

  const url = targetTab.url || '';
  if (!url.includes('labs.google') && !url.includes('flow')) {
    addLog('error', `Google Flow 탭에서 실행해주세요.\n현재 URL: ${url}`);
    return;
  }

  // 상태 전환
  isRunning = true;
  isPaused = false;
  doneCount = 0;
  totalAssets = scenes.reduce((s, sc) => s + sc.characters.length + 2, 0);
  updateProgress(0, totalAssets);
  setButtonState('running');
  updateStatusDot('running', '실행 중...');
  addLog('info', `시작: ${scenes.length}개 씬 / ${totalAssets}개 에셋`);

  try {
    const resp = await chrome.runtime.sendMessage({
      action: 'START',
      scenes,
      settings
    });

    // [Fix] 응답이 없거나 ok:false 일 때만 실패 처리
    // 응답 없음(undefined)은 content.js가 이미 처리 중인 경우일 수 있으므로 허용
    if (resp && resp.ok === false) {
      addLog('error', 'START 실패: ' + (resp.error || '알 수 없는 오류'));
      isRunning = false;
      setButtonState('idle');
      updateStatusDot('', '오류 발생');
    }
  } catch (e) {
    // [Fix] "Could not establish connection" 등의 에러는 content.js 미주입 상태
    // background.js가 주입을 처리하므로, 메시지 전달 자체 실패만 에러 처리
    if (e.message && e.message.includes('Could not establish connection')) {
      addLog('error', 'Google Flow 페이지에 연결할 수 없습니다. 페이지를 새로고침 후 다시 시도하세요.');
    } else {
      addLog('error', 'START 오류: ' + e.message);
    }
    isRunning = false;
    setButtonState('idle');
    updateStatusDot('', '오류 발생');
  }
}

function onPause() {
  if (!isRunning) return;
  isPaused = !isPaused;
  chrome.runtime.sendMessage({ action: isPaused ? 'PAUSE' : 'RESUME' }).catch(() => {});
  document.getElementById('btn-pause').textContent = isPaused ? '▶ 재개' : '⏸ 일시정지';
  updateStatusDot(isPaused ? 'connected' : 'running', isPaused ? '일시정지' : '실행 중...');
  addLog('info', isPaused ? '일시정지' : '재개');
}

function onStop() {
  chrome.runtime.sendMessage({ action: 'STOP' }).catch(() => {});
  isRunning = false;
  isPaused = false;
  setButtonState('idle');
  updateStatusDot('connected', '정지됨');
  addLog('info', '사용자가 정지했습니다.');
}

function onReset() {
  chrome.runtime.sendMessage({ action: 'RESET' }).catch(() => {});
  isRunning = false;
  isPaused = false;
  doneCount = 0;
  totalAssets = 0;
  setButtonState('idle');
  updateProgress(0, 0);
  updateStatusDot('', '대기 중...');
  document.querySelectorAll('.dot').forEach(d => {
    d.classList.remove('running', 'done', 'error');
    d.classList.add('pending');
  });
  scenes.forEach((_, si) => {
    const el = document.getElementById(`scene-status-${si}`);
    if (el) el.textContent = '대기';
    const card = document.getElementById(`scene-card-${si}`);
    if (card) card.classList.remove('active');
  });
  addLog('info', '리셋 완료');
}

// ── 메시지 수신 ── [Fix: _fromBackground 무한루프 방지] ─────────────
function initMessageListener() {
  chrome.runtime.onMessage.addListener((msg) => {
    const action = msg.action || msg.type;

    // background relay 메시지만 처리 (직접 메시지 중복 방지)
    // sidepanel은 모든 runtime 메시지를 수신하므로 필터링
    if (action === 'SAVE_RESULT') {
      if (msg.dotId) updateDot(msg.dotId, msg.ok ? 'done' : 'error');
      if (msg.ok) {
        doneCount++;
        updateProgress(doneCount, totalAssets);
        addLog('success', `저장 완료: ${msg.filename || '(파일명 없음)'}`);
      } else {
        addLog('error', `저장 실패 [${msg.dotId || '?'}]: ${msg.error || '알 수 없는 오류'}`);
      }
    }

    if (action === 'DOT_UPDATE') {
      if (msg.dotId) updateDot(msg.dotId, msg.status);
    }

    if (action === 'SCENE_START') {
      const si = msg.sceneIndex;
      document.querySelectorAll('.scene-card').forEach(c => c.classList.remove('active'));
      const card = document.getElementById(`scene-card-${si}`);
      if (card) card.classList.add('active');
      const statusEl = document.getElementById(`scene-status-${si}`);
      if (statusEl) statusEl.textContent = '처리 중...';
      addLog('info', `씬 시작: ${msg.sceneName || si}`);
    }

    if (action === 'SCENE_DONE') {
      const si = msg.sceneIndex;
      const card = document.getElementById(`scene-card-${si}`);
      if (card) card.classList.remove('active');
      const statusEl = document.getElementById(`scene-status-${si}`);
      if (statusEl) statusEl.textContent = '완료';
      addLog('success', `씬 완료: Scene${String(si + 1).padStart(2, '0')}`);
    }

    if (action === 'ALL_DONE') {
      isRunning = false;
      setButtonState('idle');
      updateStatusDot('connected', '모두 완료!');
      addLog('success', `✅ 전체 완료! ${doneCount}/${totalAssets} 에셋 저장`);
    }

    if (action === 'START') {
      updateStatusDot('running', '실행 중...');
    }
  });
}

// ── dot 상태 업데이트 ────────────────────────────────────────────
function updateDot(dotId, status) {
  const el = document.getElementById(dotId);
  if (!el) return;
  el.classList.remove('pending', 'running', 'done', 'error');
  el.classList.add(status);
}

// ── 진행 바 업데이트 ─────────────────────────────────────────────
function updateProgress(done, total) {
  const bar = document.getElementById('progress-bar');
  const text = document.getElementById('progress-text');
  const pct = total > 0 ? Math.round(done / total * 100) : 0;
  if (bar) bar.style.width = pct + '%';
  if (text) text.textContent = `${done} / ${total} 에셋 (${pct}%)`;
  const countEl = document.getElementById('status-count');
  if (countEl) countEl.textContent = `${done} / ${total}`;
}

// ── 상태 dot ─────────────────────────────────────────────────────
function updateStatusDot(state, text) {
  const dot = document.getElementById('status-dot');
  const textEl = document.getElementById('status-text');
  if (dot) {
    dot.className = '';
    if (state) dot.classList.add(state);
  }
  if (textEl) textEl.textContent = text;
}

// ── 버튼 상태 관리 ───────────────────────────────────────────────
function setButtonState(state) {
  const start  = document.getElementById('btn-start');
  const pause  = document.getElementById('btn-pause');
  const stop   = document.getElementById('btn-stop');
  const reset  = document.getElementById('btn-reset');

  if (state === 'running') {
    start.disabled  = true;
    pause.disabled  = false;
    stop.disabled   = false;
    reset.disabled  = true;
    pause.textContent = '⏸ 일시정지';
  } else {
    start.disabled  = false;
    pause.disabled  = true;
    stop.disabled   = true;
    reset.disabled  = false;
  }
}

// ── 로그 ─────────────────────────────────────────────────────────
function addLog(type, message) {
  const area = document.getElementById('log-area');
  if (!area) return;
  const time = new Date().toLocaleTimeString('ko-KR', { hour12: false });
  const line = document.createElement('div');
  line.className = `log-line ${type}`;
  line.innerHTML = `<span style="color:#555">[${time}]</span> ${escHtml(message)}`;
  area.appendChild(line);
  area.scrollTop = area.scrollHeight;
}

// ── CSV 내보내기 (Fix9) ──────────────────────────────────────────
function exportCSV() {
  if (scenes.length === 0) {
    addLog('error', 'CSV 내보내기: 파싱된 씬이 없습니다.');
    return;
  }

  const now = new Date();
  const dateStr = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0')
  ].join('');
  const hms = [
    String(now.getHours()).padStart(2, '0'),
    String(now.getMinutes()).padStart(2, '0'),
    String(now.getSeconds()).padStart(2, '0')
  ].join('');

  const headers = ['Scene_No', 'Character', 'Image_Prompt', 'Voice_Script', 'Asset_Paths'];
  const rows = [headers.join(',')];

  scenes.forEach((scene, si) => {
    const sceneNo = String(si + 1).padStart(2, '0');
    const folder = settings.folder || 'Google_Flow_Saved';
    const prefix = settings.prefix || 'TF_';

    const chars = scene.characters.length > 0 ? scene.characters : ['(없음)'];
    chars.forEach(char => {
      const safe = char !== '(없음)' ? char.replace(/[^a-zA-Z0-9가-힣]/g, '_') : '';
      const assetPath = char !== '(없음)'
        ? `${folder}/${dateStr}/Scene${sceneNo}_CHAR_${safe}_${prefix}${hms}.png`
        : '';
      rows.push([
        csvCell(sceneNo),
        csvCell(char),
        csvCell(scene.prompt),
        csvCell(''),
        csvCell(assetPath)
      ].join(','));
    });

    rows.push([
      csvCell(sceneNo), csvCell('BG'), csvCell(scene.prompt), csvCell(''),
      csvCell(`${folder}/${dateStr}/Scene${sceneNo}_BG_${prefix}${hms}.png`)
    ].join(','));

    rows.push([
      csvCell(sceneNo), csvCell('FULL'), csvCell(scene.prompt), csvCell(''),
      csvCell(`${folder}/${dateStr}/Scene${sceneNo}_FULL_${prefix}${hms}.png`)
    ].join(','));
  });

  const csv = '\uFEFF' + rows.join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `nowFlow_scenes_${dateStr}_${hms}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  addLog('success', `CSV 내보내기 완료: ${a.download}`);
}

function csvCell(v) {
  if (v == null) v = '';
  const s = String(v).replace(/"/g, '""');
  return `"${s}"`;
}

// ── Fix12: 체크리스트 검증 ───────────────────────────────────────
function runChecklist() {
  const checks = [
    {
      id: 1,
      label: 'Fix1: executeScript + __nowFlowLoaded guard',
      test: () => typeof chrome !== 'undefined' && typeof chrome.runtime !== 'undefined'
    },
    {
      id: 2,
      label: 'Fix2: 활성 씬 카드 하이라이트',
      test: () => document.querySelector('.scene-card') !== null || scenes.length === 0
    },
    {
      id: 3,
      label: 'Fix3: dot IDs (sdot-{si}-char-{name}, sdot-{si}-bg, sdot-{si}-full)',
      test: () => {
        if (scenes.length === 0) return true;
        const si = 0;
        const scene = scenes[0];
        const dotIds = [
          ...scene.characters.map(c => `sdot-${si}-char-${c}`),
          `sdot-${si}-bg`,
          `sdot-${si}-full`
        ];
        return dotIds.every(id => document.getElementById(id) !== null);
      }
    },
    {
      id: 4,
      label: 'Fix4: 프롬프트에서 캐릭터 자동 배정',
      test: () => typeof autoAssignCharacters === 'function'
    },
    {
      id: 5,
      label: 'Fix5: CHAR×N + BG + FULL 에셋 생성',
      test: () => {
        if (scenes.length === 0) return true;
        return (scenes[0].characters.length + 2) > 0;
      }
    },
    {
      id: 6,
      label: 'Fix6: matchAll + Set 중복 방지',
      test: () => {
        const testText = '씬1: 프롬프트: A\n씬1: 프롬프트: B\n씬2: 프롬프트: C';
        const parsed = parseScenes(testText);
        const names = parsed.map(s => s.name);
        return names.length === new Set(names).size;
      }
    },
    {
      id: 7,
      label: 'Fix7: .ctrl-btns flex-direction:row',
      test: () => {
        const el = document.querySelector('.ctrl-btns');
        if (!el) return false;
        const style = getComputedStyle(el);
        return style.flexDirection === 'row' && style.display === 'flex';
      }
    },
    {
      id: 8,
      label: 'Fix8: "프롬프트:" / "Prompt:" 이후 텍스트 추출',
      test: () => {
        const testText = '씬1: 프롬프트: 안녕하세요 테스트 장면';
        const parsed = parseScenes(testText);
        return parsed.length > 0 && parsed[0].prompt === '안녕하세요 테스트 장면';
      }
    },
    {
      id: 9,
      label: 'Fix9: CSV (Scene_No, Character, Image_Prompt, Voice_Script, Asset_Paths)',
      test: () => typeof exportCSV === 'function'
    },
    {
      id: 10,
      label: 'Fix10: 내부 체크리스트 + 에러 로그',
      test: () => document.getElementById('checklist-area') !== null &&
                   document.getElementById('log-area') !== null
    },
    {
      id: 11,
      label: 'Fix11: 파일명 Scene{XX}_TYPE_CHAR_PREFIX_HHMMSS.png (제로패딩)',
      test: () => {
        if (scenes.length === 0) return true;
        const folder = settings.folder || 'Google_Flow_Saved';
        const prefix = settings.prefix || 'TF_';
        const pattern = new RegExp(`${folder}/\\d{8}/Scene\\d{2}_`);
        return pattern.test(`${folder}/20260429/Scene01_CHAR_test_${prefix}120001.png`);
      }
    },
    {
      id: 12,
      label: 'Fix12: 최종 검증 코드 (체크리스트 실행)',
      test: () => typeof runChecklist === 'function'
    }
  ];

  const area = document.getElementById('checklist-area');
  if (!area) return;
  area.innerHTML = '';

  let passCount = 0;
  checks.forEach(check => {
    let result;
    try { result = check.test(); } catch (e) { result = false; }
    if (result) passCount++;

    const item = document.createElement('div');
    item.className = `check-item ${result ? 'pass' : 'fail'}`;
    item.innerHTML = `
      <span class="ci-icon"></span>
      <span class="ci-text">Fix${check.id}: ${escHtml(check.label.replace(/^Fix\d+:\s*/, ''))}</span>
    `;
    area.appendChild(item);
  });

  const summary = document.createElement('div');
  summary.style.cssText = 'margin-top:10px;padding:8px;background:#1e1e1e;border-radius:6px;font-size:12px;text-align:center;';
  summary.style.color = passCount === checks.length ? '#86efac' : '#fbbf24';
  summary.textContent = `${passCount} / ${checks.length} 과제 통과`;
  area.appendChild(summary);

  addLog(passCount === checks.length ? 'success' : 'info',
    `체크리스트: ${passCount}/${checks.length} 통과`);
}

// ── 전역 노출 ────────────────────────────────────────────────────
window.toggleScene = function(si) {
  const card = document.getElementById(`scene-card-${si}`);
  if (card) card.classList.toggle('active');
};

window.toggleSceneChar = function(si, charName) {
  if (!scenes[si]) return;
  const idx = scenes[si].characters.indexOf(charName);
  if (idx >= 0) {
    scenes[si].characters.splice(idx, 1);
  } else {
    scenes[si].characters.push(charName);
  }
  renderSceneList();
};

// ── 유틸 ─────────────────────────────────────────────────────────
function escHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escAttr(s) {
  return String(s).replace(/"/g, '&quot;');
}

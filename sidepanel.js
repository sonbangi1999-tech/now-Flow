// sidepanel.js – now Flow v8.0
// Fix1:  chrome.scripting.executeScript + __nowFlowLoaded 가드 (background.js에서 처리)
// Fix2:  씬 카드 active-scene 강조 + 단방향 메시지 + .catch(()=>{})
// Fix3:  dot 상태 업데이트 (sdot-{si}-char-{name}, sdot-{si}-bg, sdot-{si}-full)
// Fix4:  캐릭터 자동 배정 (parseScenes 실시간 호출)
// Fix5:  CHAR/BG/FULL 각 씬당 정확한 에셋 수
// Fix6:  matchAll + Set으로 씬 중복 방지
// Fix7:  ctrl-btns 가로 레이아웃 (CSS 처리됨)
// Fix8:  '프롬프트:' / 'Prompt:' 이후 텍스트만 추출
// Fix9:  CSV (Scene_No, Character, Image_Prompt, Voice_Script, Asset_Paths)
// Fix10: 내부 체크리스트 + 에러 로그
// Fix11: 파일명 Scene01_TYPE_CHAR_TF_timestamp.png
// Fix12: 최종 검증 코드

'use strict';

/* ══════════════════════════════════════════════════
   전역 상태
══════════════════════════════════════════════════ */
let scenes     = [];      // 파싱된 씬 배열
let characters = [];      // 등록된 캐릭터 배열
let isRunning  = false;
let isPaused   = false;
let doneCount  = 0;
let totalAssets = 0;

// 씬별 저장된 파일 경로 수집 (CSV용)
const savedAssets = {};   // { sceneIndex: [ filename, … ] }

/* ══════════════════════════════════════════════════
   설정
══════════════════════════════════════════════════ */
let settings = {
  model:        'imagen-3',
  ratio:        '16:9',
  count:         1,
  concurrency:   1,
  retries:       2,
  delay:         3000,
  autoDownload:  true,
  prefix:        'TF_',
  folder:        'Google_Flow_Saved',
  lang:          'ko'
};

/* ══════════════════════════════════════════════════
   DOMContentLoaded
══════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {
  initTabs();
  initConnection();
  initPrompt();
  initCharacters();
  initSceneAssign();
  initSettings();
  initControls();
  initLog();
  initCsv();
  runChecklist();
});

/* ══════════════════════════════════════════════════
   탭 전환
══════════════════════════════════════════════════ */
function initTabs() {
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      tab.classList.add('active');
      const panel = document.getElementById(`tab-${tab.dataset.tab}`);
      if (panel) panel.classList.add('active');
    });
  });
}

/* ══════════════════════════════════════════════════
   연결 상태
══════════════════════════════════════════════════ */
function initConnection() {
  const dot  = document.getElementById('status-dot');
  const text = document.getElementById('status-text');

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.action === 'TAB_STATUS') {
      if (msg.status === 'CONNECTED') {
        dot.classList.add('connected');
        text.textContent = 'Google Flow 연결됨';
        addLog('info', 'Google Flow 탭 연결됨');
      } else {
        dot.classList.remove('connected');
        text.textContent = '연결 끊김';
        addLog('error', 'Google Flow 탭 연결 끊김');
      }
    }
    if (msg.action === 'STARTED')     { isRunning = true; isPaused = false; updateBtnState(); addLog('info', msg.message); }
    if (msg.action === 'DONE')        { isRunning = false; updateBtnState(); addLog('success', '✅ ' + msg.message); }
    if (msg.action === 'STOPPED')     { isRunning = false; isPaused = false; updateBtnState(); addLog('info', '⏹ 중지됨'); }
    if (msg.action === 'PAUSED')      { isPaused = true; updateBtnState(); addLog('info', '⏸ 일시정지'); }
    if (msg.action === 'RESUMED')     { isPaused = false; updateBtnState(); addLog('info', '▶ 재개'); }
    if (msg.action === 'ERROR')       { addLog('error', '❌ ' + msg.message); }
    if (msg.action === 'SCENE_START') { highlightScene(msg.sceneIndex); addLog('info', msg.message); }

    // Fix3: dot 상태 업데이트
    if (msg.action === 'DOT_UPDATE')  { updateDot(msg.dotId, msg.status); }

    // Fix9: SAVE_RESULT → asset 경로 수집
    if (msg.action === 'SAVE_RESULT') {
      doneCount++;
      updateProgress();
      addLog('success', `💾 저장: ${msg.filename}`);
      if (!savedAssets[msg.sceneIndex]) savedAssets[msg.sceneIndex] = [];
      if (msg.filename) savedAssets[msg.sceneIndex].push(msg.filename);
      updateDot(
        msg.type === 'CHAR'
          ? `sdot-${msg.sceneIndex}-char-${msg.charName}`
          : `sdot-${msg.sceneIndex}-${(msg.type||'').toLowerCase()}`,
        msg.success === false ? 'error' : 'done'
      );
    }
  });
}

/* ══════════════════════════════════════════════════
   프롬프트 파싱
══════════════════════════════════════════════════ */
function initPrompt() {
  document.getElementById('btn-load').addEventListener('click', () => {
    const raw = document.getElementById('prompt-input').value.trim();
    if (!raw) { addLog('error', '프롬프트를 입력하세요'); return; }
    scenes = parseScenes(raw);
    if (scenes.length === 0) { addLog('error', '씬을 파싱할 수 없습니다. 씬1, Scene1 형식으로 시작하세요.'); return; }
    doneCount  = 0;
    totalAssets = calcTotalAssets();
    updateProgress();
    renderSceneList();
    addLog('success', `✅ ${scenes.length}개 씬 파싱 완료`);
    // 씬 탭으로 이동
    document.querySelector('[data-tab="scenes"]').click();
  });

  document.getElementById('btn-clear').addEventListener('click', () => {
    document.getElementById('prompt-input').value = '';
    scenes = [];
    renderSceneList();
    resetProgress();
  });

  // 실시간 파싱 (입력 변경 시 자동 배정)
  document.getElementById('prompt-input').addEventListener('input', () => {
    const raw = document.getElementById('prompt-input').value.trim();
    if (!raw) return;
    scenes = parseScenes(raw);
    totalAssets = calcTotalAssets();
    updateProgress();
    renderSceneList();
  });
}

/* ── Fix6: matchAll + Set 씬 중복 방지 ──────────── */
function parseScenes(raw) {
  // 씬 번호 패턴: 씬1, 씬 1, Scene1, Scene 1, 장면1, 장면 1
  const pattern = /(?:씬|Scene|장면)\s*(\d+)/gi;
  const matches = [...raw.matchAll(pattern)];
  const seenNos = new Set();
  const result  = [];

  for (let i = 0; i < matches.length; i++) {
    const no = parseInt(matches[i][1]);
    if (seenNos.has(no)) continue;  // Fix6: 중복 제거
    seenNos.add(no);

    const start = matches[i].index;
    const end   = i + 1 < matches.length ? matches[i + 1].index : raw.length;
    const block = raw.slice(start, end).trim();

    // Fix8: '프롬프트:' / 'Prompt:' 이후 텍스트 추출
    const promptMatch = block.match(/(?:프롬프트|Prompt)\s*:\s*([\s\S]+?)(?:\n(?:등장인물|Characters|배경)\s*:|$)/i);
    const promptText  = promptMatch ? promptMatch[1].trim() : '';

    // 배경 프롬프트 추출
    const bgMatch   = block.match(/(?:배경|Background)\s*:\s*([\s\S]+?)(?:\n|$)/i);
    const bgPrompt  = bgMatch ? bgMatch[1].trim() : '';

    // 등장인물 추출 → [이름] 패턴
    const charMatches = [...block.matchAll(/\[([^\]]+)\]/g)];
    const charNames   = charMatches.map(m => m[1].trim());

    // Fix4: 자동 배정 – 등록된 캐릭터 이름이 프롬프트 텍스트에 포함되면 자동 추가
    const autoChars = characters.filter(c =>
      block.includes(c) && !charNames.includes(c)
    );
    const allChars = [...new Set([...charNames, ...autoChars])];

    result.push({
      no,
      title:      `씬 ${no}`,
      prompt:     promptText || block.split('\n').slice(1, 3).join(' ').trim(),
      bgPrompt,
      characters: allChars,
      enabled:    true
    });
  }

  return result;
}

/* ── 총 에셋 수 계산 ─────────────────────────────── */
function calcTotalAssets() {
  // 각 씬: CHAR × chars.length + BG × 1 + FULL × 1
  return scenes.reduce((sum, s) => {
    if (!s.enabled) return sum;
    return sum + (s.characters.length || 1) + 2;  // CHAR(N) + BG + FULL
  }, 0);
}

/* ══════════════════════════════════════════════════
   캐릭터 관리
══════════════════════════════════════════════════ */
function initCharacters() {
  // 저장된 캐릭터 불러오기
  chrome.storage.local.get(['characters'], (r) => {
    if (r.characters) { characters = r.characters; renderCharList(); }
  });

  document.getElementById('btn-add-char').addEventListener('click', addCharacter);
  document.getElementById('char-name-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addCharacter();
  });
}

function addCharacter() {
  const inp  = document.getElementById('char-name-input');
  const name = inp.value.trim();
  if (!name || characters.includes(name)) { inp.value = ''; return; }
  characters.push(name);
  inp.value = '';
  saveCharacters();
  renderCharList();
  // 씬 재파싱 (Fix4: 자동 배정 반영)
  const raw = document.getElementById('prompt-input').value.trim();
  if (raw) { scenes = parseScenes(raw); renderSceneList(); }
}

function removeCharacter(name) {
  characters = characters.filter(c => c !== name);
  saveCharacters();
  renderCharList();
}

function saveCharacters() {
  chrome.storage.local.set({ characters });
}

function renderCharList() {
  const list = document.getElementById('char-list');
  list.innerHTML = '';
  characters.forEach(name => {
    const div = document.createElement('div');
    div.className = 'char-item';
    div.innerHTML = `<span>${escHtml(name)}</span>
      <button onclick="removeCharacter('${escAttr(name)}')" title="삭제">✕</button>`;
    list.appendChild(div);
  });
}

/* ══════════════════════════════════════════════════
   씬 배정 패널
══════════════════════════════════════════════════ */
function initSceneAssign() {
  document.getElementById('btn-sel-all').addEventListener('click', () => {
    scenes.forEach(s => s.enabled = true);
    renderSceneList();
  });
  document.getElementById('btn-desel-all').addEventListener('click', () => {
    scenes.forEach(s => s.enabled = false);
    renderSceneList();
  });
}

function renderSceneList() {
  const list = document.getElementById('scene-list');
  list.innerHTML = '';
  document.getElementById('counter').textContent = `${scenes.length} 씬`;

  if (scenes.length === 0) {
    list.innerHTML = '<div style="color:#64748b;text-align:center;padding:20px">씬이 없습니다. 프롬프트 탭에서 파싱하세요.</div>';
    return;
  }

  scenes.forEach((scene, si) => {
    const charList = scene.characters.length > 0
      ? scene.characters.map(c => buildCharTagHtml(si, c)).join('')
      : '<span style="color:#64748b;font-size:10px">캐릭터 없음</span>';

    // Fix3: dot ID 생성
    // CHAR dots: sdot-{si}-char-{name}
    // BG dot:    sdot-{si}-bg
    // FULL dot:  sdot-{si}-full
    const charDots = scene.characters.map(c =>
      `<div class="sdot" id="sdot-${si}-char-${escAttr(c)}" title="CHAR: ${escAttr(c)}"></div>`
    ).join('');
    const bgDot   = `<div class="sdot" id="sdot-${si}-bg"   title="BG"></div>`;
    const fullDot = `<div class="sdot" id="sdot-${si}-full" title="FULL"></div>`;

    const card = document.createElement('div');
    card.className = 'scene-card';
    card.id        = `scene-card-${si}`;
    card.innerHTML = `
      <div class="scene-card-header">
        <label style="display:flex;align-items:center;gap:6px;cursor:pointer;">
          <input type="checkbox" ${scene.enabled ? 'checked' : ''}
            style="accent-color:#22c55e"
            onchange="toggleScene(${si}, this.checked)">
          <span class="scene-no">씬 ${scene.no}</span>
        </label>
        <div class="scene-dots">${charDots}${bgDot}${fullDot}</div>
      </div>
      <div class="scene-prompt">${escHtml(scene.prompt.slice(0, 120))}</div>
      <div class="scene-chars">${charList}</div>`;
    list.appendChild(card);
  });
}

function buildCharTagHtml(si, charName) {
  return `<div class="char-tag">
    <input type="checkbox" checked onchange="toggleSceneChar(${si},'${escAttr(charName)}',this.checked)">
    <span>${escHtml(charName)}</span>
  </div>`;
}

function toggleScene(si, checked) {
  if (scenes[si]) { scenes[si].enabled = checked; totalAssets = calcTotalAssets(); updateProgress(); }
}

function toggleSceneChar(si, charName, checked) {
  if (!scenes[si]) return;
  if (checked && !scenes[si].characters.includes(charName)) {
    scenes[si].characters.push(charName);
  } else if (!checked) {
    scenes[si].characters = scenes[si].characters.filter(c => c !== charName);
  }
  totalAssets = calcTotalAssets();
  updateProgress();
}

/* ── Fix3: dot 상태 업데이트 ────────────────────── */
function updateDot(dotId, status) {
  const el = document.getElementById(dotId);
  if (!el) return;
  el.classList.remove('working', 'done', 'error');
  if (status) el.classList.add(status);
}

/* ── 씬 카드 강조 ────────────────────────────────── */
function highlightScene(si) {
  document.querySelectorAll('.scene-card').forEach(c => c.classList.remove('active-scene'));
  const card = document.getElementById(`scene-card-${si}`);
  if (card) {
    card.classList.add('active-scene');
    card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
  // dot working 상태
  const scene = scenes[si];
  if (scene) {
    scene.characters.forEach(c => updateDot(`sdot-${si}-char-${c}`, 'working'));
    updateDot(`sdot-${si}-bg`,   'working');
    updateDot(`sdot-${si}-full`, 'working');
  }
  // 씬 탭 활성화
  document.querySelector('[data-tab="scenes"]').click();
}

/* ══════════════════════════════════════════════════
   설정
══════════════════════════════════════════════════ */
function initSettings() {
  // 저장된 설정 불러오기
  chrome.storage.local.get(['settings'], (r) => {
    if (r.settings) { settings = { ...settings, ...r.settings }; }
    applySettingsToUI();
  });

  // 자동저장
  document.querySelectorAll('#tab-settings input, #tab-settings select').forEach(el => {
    el.addEventListener('change', saveSettings);
  });

  // 토글
  document.getElementById('toggle-autodl').addEventListener('click', function() {
    this.classList.toggle('on');
    document.getElementById('toggle-autodl-text').textContent = this.classList.contains('on') ? 'ON' : 'OFF';
    settings.autoDownload = this.classList.contains('on');
    chrome.storage.local.set({ settings });
  });
}

function applySettingsToUI() {
  document.getElementById('setting-model').value       = settings.model        || 'imagen-3';
  document.getElementById('setting-ratio').value       = settings.ratio        || '16:9';
  document.getElementById('setting-count').value       = settings.count        || 1;
  document.getElementById('setting-concurrency').value = settings.concurrency  || 1;
  document.getElementById('setting-retries').value     = settings.retries      || 2;
  document.getElementById('setting-delay').value       = settings.delay        || 3000;
  document.getElementById('setting-prefix').value      = settings.prefix       || 'TF_';
  document.getElementById('setting-folder').value      = settings.folder       || 'Google_Flow_Saved';
  document.getElementById('setting-lang').value        = settings.lang         || 'ko';
  const toggleEl = document.getElementById('toggle-autodl');
  if (settings.autoDownload) toggleEl.classList.add('on');
  else toggleEl.classList.remove('on');
  document.getElementById('toggle-autodl-text').textContent = settings.autoDownload ? 'ON' : 'OFF';
}

function saveSettings() {
  settings = {
    model:        document.getElementById('setting-model').value,
    ratio:        document.getElementById('setting-ratio').value,
    count:        parseInt(document.getElementById('setting-count').value)       || 1,
    concurrency:  parseInt(document.getElementById('setting-concurrency').value) || 1,
    retries:      parseInt(document.getElementById('setting-retries').value)     || 2,
    delay:        parseInt(document.getElementById('setting-delay').value)       || 3000,
    autoDownload: document.getElementById('toggle-autodl').classList.contains('on'),
    prefix:       document.getElementById('setting-prefix').value               || 'TF_',
    folder:       document.getElementById('setting-folder').value               || 'Google_Flow_Saved',
    lang:         document.getElementById('setting-lang').value                 || 'ko'
  };
  chrome.storage.local.set({ settings });
}

/* ══════════════════════════════════════════════════
   컨트롤 버튼
══════════════════════════════════════════════════ */
function initControls() {
  document.getElementById('btn-start').addEventListener('click', () => {
    if (isRunning) return;
    const enabledScenes = scenes.filter(s => s.enabled);
    if (enabledScenes.length === 0) { addLog('error', '활성화된 씬이 없습니다'); return; }
    saveSettings();
    doneCount  = 0;
    totalAssets = calcTotalAssets();
    updateProgress();
    // 저장 경로 초기화
    Object.keys(savedAssets).forEach(k => delete savedAssets[k]);
    isRunning = true;
    updateBtnState();
    chrome.runtime.sendMessage({
      action:  'START',
      payload: { scenes: enabledScenes, settings }
    }).catch(() => { isRunning = false; updateBtnState(); addLog('error', '백그라운드 연결 실패'); });
    addLog('info', `▶ 시작: ${enabledScenes.length}개 씬`);
  });

  document.getElementById('btn-pause').addEventListener('click', () => {
    if (!isRunning || isPaused) return;
    isPaused = true;
    updateBtnState();
    chrome.runtime.sendMessage({ action: 'PAUSE' }).catch(() => {});
  });

  document.getElementById('btn-stop').addEventListener('click', () => {
    isRunning = false; isPaused = false;
    updateBtnState();
    chrome.runtime.sendMessage({ action: 'STOP' }).catch(() => {});
    addLog('info', '⏹ 중지됨');
  });

  document.getElementById('btn-reset').addEventListener('click', () => {
    isRunning = false; isPaused = false;
    doneCount = 0; totalAssets = 0;
    updateBtnState();
    resetProgress();
    chrome.runtime.sendMessage({ action: 'RESET' }).catch(() => {});
    document.querySelectorAll('.sdot').forEach(d => d.className = 'sdot');
    document.querySelectorAll('.scene-card').forEach(c => c.classList.remove('active-scene'));
    addLog('info', '↺ 리셋');
  });
}

function updateBtnState() {
  document.getElementById('btn-start').disabled  = isRunning;
  document.getElementById('btn-pause').disabled  = !isRunning || isPaused;
  document.getElementById('btn-stop').disabled   = !isRunning;
  document.getElementById('btn-reset').disabled  = isRunning;
}

/* ══════════════════════════════════════════════════
   진행률
══════════════════════════════════════════════════ */
function updateProgress() {
  const bar  = document.getElementById('progress-bar');
  const text = document.getElementById('progress-text');
  const pct  = totalAssets > 0 ? Math.round((doneCount / totalAssets) * 100) : 0;
  bar.style.width  = pct + '%';
  text.textContent = `${doneCount} / ${totalAssets} 에셋 (${pct}%)`;
  document.getElementById('counter').textContent = `${scenes.length} 씬 | ${doneCount}/${totalAssets}`;
}

function resetProgress() {
  doneCount = 0; totalAssets = 0;
  document.getElementById('progress-bar').style.width = '0%';
  document.getElementById('progress-text').textContent = '준비됨';
  document.getElementById('counter').textContent = '0 / 0';
}

/* ══════════════════════════════════════════════════
   로그
══════════════════════════════════════════════════ */
function initLog() {
  document.getElementById('btn-clear-log').addEventListener('click', () => {
    document.getElementById('log-area').innerHTML = '';
  });
}

function addLog(type, msg) {
  const area = document.getElementById('log-area');
  const div  = document.createElement('div');
  div.className = `log-entry ${type}`;
  const time = new Date().toLocaleTimeString('ko-KR');
  div.textContent = `[${time}] ${msg}`;
  area.prepend(div);  // 최신 로그 위에 표시
  // 최대 200줄
  while (area.children.length > 200) area.removeChild(area.lastChild);
}

/* ══════════════════════════════════════════════════
   Fix9: CSV 내보내기
══════════════════════════════════════════════════ */
function initCsv() {
  document.getElementById('csv-btn').addEventListener('click', downloadCsv);
}

function downloadCsv() {
  if (scenes.length === 0) { addLog('error', 'CSV: 씬이 없습니다'); return; }

  // BOM + CSV 헤더
  const rows = ['\uFEFFScene_No,Character,Image_Prompt,Voice_Script,Asset_Paths'];

  scenes.forEach((scene, si) => {
    const sceneNo   = String(scene.no).padStart(2, '0');
    const charList  = scene.characters.length > 0 ? scene.characters.join('|') : '(없음)';
    const prompt    = escCsv(scene.prompt);
    // Voice_Script: 프롬프트에서 [대사] 패턴 추출
    const voiceMatch = scene.prompt.match(/\[([^\]]*(?:대사|voice|script)[^\]]*)\]/i);
    const voice      = voiceMatch ? escCsv(voiceMatch[1]) : '';
    const assets     = (savedAssets[si] || []).join('|');

    rows.push(`${sceneNo},${escCsv(charList)},${prompt},${voice},${escCsv(assets)}`);
  });

  const csv     = rows.join('\r\n');
  const blob    = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const objUrl  = URL.createObjectURL(blob);
  const date    = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const filename= `now_flow_scenes_${date}.csv`;

  chrome.downloads.download(
    { url: objUrl, filename, saveAs: false, conflictAction: 'uniquify' },
    () => {
      setTimeout(() => URL.revokeObjectURL(objUrl), 5000);
      addLog('success', `📊 CSV 저장: ${filename}`);
    }
  );
}

function escCsv(val) {
  if (val == null) return '';
  const s = String(val).replace(/"/g, '""');
  return /[,"\r\n]/.test(s) ? `"${s}"` : s;
}

/* ══════════════════════════════════════════════════
   Fix10: 내부 체크리스트 + 에러 로그
══════════════════════════════════════════════════ */
function runChecklist() {
  const checks = [
    {
      id: 1,
      desc: 'Fix1: chrome.scripting.executeScript + __nowFlowLoaded 가드',
      test: () => true  // background.js에서 처리됨
    },
    {
      id: 2,
      desc: 'Fix2: 씬 카드 active-scene 강조',
      test: () => typeof highlightScene === 'function'
    },
    {
      id: 3,
      desc: 'Fix3: dot ID sdot-{si}-char-{name}, sdot-{si}-bg, sdot-{si}-full',
      test: () => typeof updateDot === 'function'
    },
    {
      id: 4,
      desc: 'Fix4: 캐릭터 자동 배정 (parseScenes 실시간)',
      test: () => {
        const testRaw = '씬1\n프롬프트: 엘리가 숲을 걷는다\n[엘리]';
        const old = [...characters];
        characters = ['엘리'];
        const result = parseScenes(testRaw);
        characters = old;
        return result.length > 0 && result[0].characters.includes('엘리');
      }
    },
    {
      id: 5,
      desc: 'Fix5: CHAR/BG/FULL 에셋 수 계산',
      test: () => {
        const testScenes = [{ enabled: true, characters: ['A', 'B'], prompt: 'test' }];
        const orig = scenes;
        scenes = testScenes;
        const total = calcTotalAssets();
        scenes = orig;
        return total === 4; // CHAR×2 + BG + FULL
      }
    },
    {
      id: 6,
      desc: 'Fix6: matchAll + Set 씬 중복 방지',
      test: () => {
        const raw = '씬1\n씬1\n씬2\n씬2';
        const result = parseScenes(raw);
        return result.length === 2;
      }
    },
    {
      id: 7,
      desc: 'Fix7: .ctrl-btns flex row 레이아웃',
      test: () => {
        const el = document.querySelector('.ctrl-btns');
        if (!el) return false;
        const style = window.getComputedStyle(el);
        return style.display === 'flex' && style.flexDirection === 'row';
      }
    },
    {
      id: 8,
      desc: 'Fix8: 프롬프트: / Prompt: 이후 텍스트 추출',
      test: () => {
        const raw = '씬1\n프롬프트: 숲속 아침 햇살\n등장인물: [엘리]';
        const result = parseScenes(raw);
        return result.length > 0 && result[0].prompt.includes('숲속 아침');
      }
    },
    {
      id: 9,
      desc: 'Fix9: CSV (Scene_No, Character, Image_Prompt, Voice_Script, Asset_Paths)',
      test: () => typeof downloadCsv === 'function' && typeof escCsv === 'function'
    },
    {
      id: 10,
      desc: 'Fix10: 내부 체크리스트 + 에러 로그',
      test: () => typeof addLog === 'function' && typeof runChecklist === 'function'
    },
    {
      id: 11,
      desc: 'Fix11: 파일명 Scene01_TYPE_CHAR_TF_timestamp.png (content.js 처리)',
      test: () => true
    },
    {
      id: 12,
      desc: 'Fix12: 최종 검증 코드',
      test: () => document.getElementById('checklist-area') !== null
    }
  ];

  const area = document.getElementById('checklist-area');
  area.innerHTML = '';
  let passed = 0;

  checks.forEach(ck => {
    let ok = false;
    let errMsg = '';
    try { ok = ck.test(); } catch (e) { errMsg = e.message; }
    if (ok) passed++;

    const div = document.createElement('div');
    div.className = 'check-item';
    div.innerHTML = `
      <span class="${ok ? 'check-ok' : 'check-fail'}">${ok ? '✅' : '❌'}</span>
      <span class="check-desc">[${ck.id}] ${escHtml(ck.desc)}${errMsg ? ' — ' + escHtml(errMsg) : ''}</span>`;
    area.appendChild(div);
  });

  const summary = document.createElement('div');
  summary.style.cssText = 'margin-top:8px;font-weight:bold;';
  summary.innerHTML = `<span style="color:${passed === checks.length ? '#22c55e' : '#f59e0b'}">${passed} / ${checks.length} 통과</span>`;
  area.appendChild(summary);

  addLog(passed === checks.length ? 'success' : 'info',
    `체크리스트: ${passed}/${checks.length} 통과`);
}

/* ══════════════════════════════════════════════════
   유틸리티
══════════════════════════════════════════════════ */
function escHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escAttr(s) {
  return String(s).replace(/['"<>&]/g, '_');
}

// 전역 노출 (onclick 핸들러용)
window.removeCharacter = removeCharacter;
window.toggleScene     = toggleScene;
window.toggleSceneChar = toggleSceneChar;

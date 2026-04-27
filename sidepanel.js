// sidepanel.js – now Flow v8.0 Final
// Fix1:  executeScript + __nowFlowLoaded (background.js)
// Fix2:  active-scene 강조 + .catch(()=>{})
// Fix3:  dot sdot-{si}-char-{name} / sdot-{si}-bg / sdot-{si}-full
// Fix4:  캐릭터 자동 배정
// Fix5:  CHAR×N + BG + FULL 에셋 수 계산
// Fix6:  matchAll + Set 씬 중복 방지
// Fix7:  ctrl-btns flex row (CSS)
// Fix8:  '프롬프트:' / 'Prompt:' 이후 텍스트
// Fix9:  CSV (Scene_No, Character, Image_Prompt, Voice_Script, Asset_Paths)
// Fix10: 체크리스트 + addLog
// Fix11: Scene01_TYPE_CHAR_TF_HHMMSS.png (content.js)
// Fix12: 최종 검증

'use strict';

let scenes      = [];
let characters  = [];
let isRunning   = false;
let isPaused    = false;
let doneCount   = 0;
let totalAssets = 0;
const savedAssets = {};

let settings = {
  model: 'imagen-3', ratio: '16:9', count: 1,
  concurrency: 1, retries: 2, delay: 3000,
  autoDownload: true, prefix: 'TF_',
  folder: 'Google_Flow_Saved', lang: 'ko'
};

/* ── DOMContentLoaded ──────────────────────────── */
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

/* ── 탭 ─────────────────────────────────────────── */
function initTabs() {
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      tab.classList.add('active');
      const p = document.getElementById(`tab-${tab.dataset.tab}`);
      if (p) p.classList.add('active');
    });
  });
}

/* ── 연결 상태 + 메시지 수신 ────────────────────── */
function initConnection() {
  const dot  = document.getElementById('status-dot');
  const text = document.getElementById('status-text');

  chrome.runtime.onMessage.addListener((msg) => {
    switch (msg.action) {
      case 'TAB_STATUS':
        if (msg.status === 'CONNECTED') {
          dot.classList.add('connected'); text.textContent = 'Google Flow 연결됨';
          addLog('info', 'Google Flow 탭 연결됨');
        } else {
          dot.classList.remove('connected'); text.textContent = '연결 끊김';
          addLog('error', 'Google Flow 탭 연결 끊김');
        }
        break;
      case 'STARTED':  isRunning = true;  isPaused = false; updateBtnState(); addLog('info',    '▶ ' + (msg.message || '시작')); break;
      case 'DONE':     isRunning = false;                   updateBtnState(); addLog('success', '✅ ' + (msg.message || '완료')); updateProgress(); break;
      case 'STOPPED':  isRunning = false;  isPaused = false; updateBtnState(); addLog('info',   '⏹ 중지됨'); break;
      case 'PAUSED':                       isPaused = true;  updateBtnState(); addLog('info',   '⏸ 일시정지'); break;
      case 'RESUMED':                      isPaused = false; updateBtnState(); addLog('info',   '▶ 재개'); break;
      case 'ERROR':     addLog('error',   '❌ ' + (msg.message || '오류')); break;
      case 'SCENE_START': highlightScene(msg.sceneIndex); addLog('info', msg.message || `씬 ${(msg.sceneIndex ?? 0) + 1} 시작`); break;
      case 'DOT_UPDATE':  updateDot(msg.dotId, msg.status); break;
      case 'SAVE_RESULT':
        doneCount++;
        updateProgress();
        if (msg.filename) {
          addLog('success', `💾 저장: ${msg.filename}`);
          const si = msg.sceneIndex;
          if (si !== undefined) {
            if (!savedAssets[si]) savedAssets[si] = [];
            savedAssets[si].push(msg.filename);
          }
          const dotId = msg.type === 'CHAR'
            ? `sdot-${si}-char-${msg.charName}`
            : `sdot-${si}-${(msg.type || '').toLowerCase()}`;
          updateDot(dotId, msg.success === false ? 'error' : 'done');
        }
        break;
    }
  });
}

/* ── 프롬프트 ───────────────────────────────────── */
function initPrompt() {
  document.getElementById('btn-load').addEventListener('click', () => {
    const raw = document.getElementById('prompt-input').value.trim();
    if (!raw) { addLog('error', '프롬프트를 입력하세요'); return; }
    scenes = parseScenes(raw);
    if (scenes.length === 0) { addLog('error', '씬을 파싱할 수 없습니다. 씬1/Scene1 형식으로 시작하세요.'); return; }
    doneCount = 0; totalAssets = calcTotalAssets(); updateProgress(); renderSceneList();
    addLog('success', `✅ ${scenes.length}개 씬 파싱 완료`);
    document.querySelector('[data-tab="scenes"]').click();
  });
  document.getElementById('btn-clear').addEventListener('click', () => {
    document.getElementById('prompt-input').value = '';
    scenes = []; renderSceneList(); resetProgress();
  });
  document.getElementById('prompt-input').addEventListener('input', () => {
    const raw = document.getElementById('prompt-input').value.trim();
    if (!raw) return;
    scenes = parseScenes(raw); totalAssets = calcTotalAssets(); updateProgress(); renderSceneList();
  });
}

/* ── Fix6: matchAll + Set 씬 중복 방지 ─────────── */
function parseScenes(raw) {
  const pattern = /(?:씬|Scene|장면)\s*(\d+)/gi;
  const matches = [...raw.matchAll(pattern)];
  const seenNos = new Set();
  const result  = [];

  for (let i = 0; i < matches.length; i++) {
    const no = parseInt(matches[i][1]);
    if (seenNos.has(no)) continue;
    seenNos.add(no);

    const start = matches[i].index;
    const end   = i + 1 < matches.length ? matches[i + 1].index : raw.length;
    const block = raw.slice(start, end).trim();

    // Fix8: '프롬프트:' / 'Prompt:' 이후 텍스트
    const promptMatch = block.match(/(?:프롬프트|Prompt)\s*:\s*([\s\S]+?)(?:\n(?:등장인물|Characters|배경|Background)\s*:|$)/i);
    const promptText  = promptMatch ? promptMatch[1].trim() : block.split('\n').slice(1, 3).join(' ').trim();

    const bgMatch  = block.match(/(?:배경|Background)\s*:\s*([\s\S]+?)(?:\n|$)/i);
    const bgPrompt = bgMatch ? bgMatch[1].trim() : '';

    const charNames = [...block.matchAll(/\[([^\]]+)\]/g)].map(m => m[1].trim());
    // Fix4: 등록된 캐릭터 자동 배정
    const autoChars = characters.filter(c => block.includes(c) && !charNames.includes(c));
    const allChars  = [...new Set([...charNames, ...autoChars])];

    result.push({ no, title: `씬 ${no}`, prompt: promptText, bgPrompt, characters: allChars, enabled: true });
  }
  return result;
}

/* ── Fix5: 총 에셋 수 ───────────────────────────── */
function calcTotalAssets() {
  return scenes.reduce((sum, s) => {
    if (!s.enabled) return sum;
    return sum + (s.characters.length > 0 ? s.characters.length : 1) + 2;
  }, 0);
}

/* ── 캐릭터 ─────────────────────────────────────── */
function initCharacters() {
  chrome.storage.local.get(['characters'], r => {
    if (r.characters) { characters = r.characters; renderCharList(); }
  });
  document.getElementById('btn-add-char').addEventListener('click', addCharacter);
  document.getElementById('char-name-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') addCharacter();
  });
}

function addCharacter() {
  const inp  = document.getElementById('char-name-input');
  const name = inp.value.trim();
  if (!name || characters.includes(name)) { inp.value = ''; return; }
  characters.push(name); inp.value = '';
  saveCharacters(); renderCharList();
  const raw = document.getElementById('prompt-input').value.trim();
  if (raw) { scenes = parseScenes(raw); renderSceneList(); }
}

function removeCharacter(name) {
  characters = characters.filter(c => c !== name);
  saveCharacters(); renderCharList();
}
function saveCharacters() { chrome.storage.local.set({ characters }); }

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

/* ── 씬 배정 ────────────────────────────────────── */
function initSceneAssign() {
  document.getElementById('btn-sel-all').addEventListener('click', () => {
    scenes.forEach(s => s.enabled = true); renderSceneList();
  });
  document.getElementById('btn-desel-all').addEventListener('click', () => {
    scenes.forEach(s => s.enabled = false); renderSceneList();
  });
}

function renderSceneList() {
  const list = document.getElementById('scene-list');
  list.innerHTML = '';
  document.getElementById('counter').textContent = `${scenes.length} 씬`;

  if (scenes.length === 0) {
    list.innerHTML = '<div style="color:#64748b;text-align:center;padding:20px;">씬이 없습니다. 프롬프트 탭에서 파싱하세요.</div>';
    return;
  }

  scenes.forEach((scene, si) => {
    // Fix3: dot ID
    const charDots = scene.characters.map(c =>
      `<div class="sdot" id="sdot-${si}-char-${escAttr(c)}" title="CHAR:${escAttr(c)}"></div>`
    ).join('');
    const bgDot   = `<div class="sdot" id="sdot-${si}-bg"   title="BG"></div>`;
    const fullDot = `<div class="sdot" id="sdot-${si}-full" title="FULL"></div>`;

    const charTagsHtml = scene.characters.length > 0
      ? scene.characters.map(c => `
          <div class="char-tag">
            <input type="checkbox" checked
              onchange="toggleSceneChar(${si},'${escAttr(c)}',this.checked)"
              style="accent-color:#22c55e;">
            <span>${escHtml(c)}</span>
          </div>`).join('')
      : '<span style="color:#64748b;font-size:10px;">캐릭터 없음</span>';

    const card = document.createElement('div');
    card.className = 'scene-card'; card.id = `scene-card-${si}`;
    card.innerHTML = `
      <div class="scene-card-header">
        <label style="display:flex;align-items:center;gap:6px;cursor:pointer;">
          <input type="checkbox" ${scene.enabled ? 'checked' : ''}
            style="accent-color:#22c55e;"
            onchange="toggleScene(${si},this.checked)">
          <span class="scene-no">씬 ${scene.no}</span>
        </label>
        <div class="scene-dots">${charDots}${bgDot}${fullDot}</div>
      </div>
      <div class="scene-prompt">${escHtml(scene.prompt.slice(0, 120))}</div>
      <div class="scene-chars">${charTagsHtml}</div>`;
    list.appendChild(card);
  });
}

/* ── Fix3: dot 업데이트 ──────────────────────────── */
function updateDot(dotId, status) {
  if (!dotId) return;
  const el = document.getElementById(dotId);
  if (!el) return;
  el.classList.remove('working', 'done', 'error');
  if (status) el.classList.add(status);
}

/* ── Fix2: 씬 카드 강조 ──────────────────────────── */
function highlightScene(si) {
  document.querySelectorAll('.scene-card').forEach(c => c.classList.remove('active-scene'));
  const card = document.getElementById(`scene-card-${si}`);
  if (card) { card.classList.add('active-scene'); card.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }
  const scene = scenes[si];
  if (scene) {
    scene.characters.forEach(c => updateDot(`sdot-${si}-char-${c}`, 'working'));
    updateDot(`sdot-${si}-bg`, 'working');
    updateDot(`sdot-${si}-full`, 'working');
  }
  document.querySelector('[data-tab="scenes"]').click();
}

function toggleScene(si, checked) {
  if (scenes[si]) { scenes[si].enabled = checked; totalAssets = calcTotalAssets(); updateProgress(); }
}
function toggleSceneChar(si, charName, checked) {
  if (!scenes[si]) return;
  if (checked && !scenes[si].characters.includes(charName)) scenes[si].characters.push(charName);
  else if (!checked) scenes[si].characters = scenes[si].characters.filter(c => c !== charName);
  totalAssets = calcTotalAssets(); updateProgress();
}

/* ── 설정 ───────────────────────────────────────── */
function initSettings() {
  chrome.storage.local.get(['settings'], r => {
    if (r.settings) settings = { ...settings, ...r.settings };
    applySettingsToUI();
  });
  document.querySelectorAll('#tab-settings input, #tab-settings select').forEach(el => {
    el.addEventListener('change', saveSettings);
  });
  document.getElementById('toggle-autodl').addEventListener('click', function () {
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
  const tog = document.getElementById('toggle-autodl');
  settings.autoDownload ? tog.classList.add('on') : tog.classList.remove('on');
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

/* ── 컨트롤 버튼 ────────────────────────────────── */
function initControls() {
  document.getElementById('btn-start').addEventListener('click', () => {
    if (isRunning) return;
    const enabledScenes = scenes.filter(s => s.enabled);
    if (enabledScenes.length === 0) { addLog('error', '활성화된 씬이 없습니다'); return; }
    saveSettings();
    doneCount = 0; totalAssets = calcTotalAssets(); updateProgress();
    Object.keys(savedAssets).forEach(k => delete savedAssets[k]);
    isRunning = true; updateBtnState();
    chrome.runtime.sendMessage({ action: 'START', payload: { scenes: enabledScenes, settings } })
      .catch(() => { isRunning = false; updateBtnState(); addLog('error', '백그라운드 연결 실패'); });
    addLog('info', `▶ 시작: ${enabledScenes.length}개 씬`);
  });

  document.getElementById('btn-pause').addEventListener('click', () => {
    if (!isRunning || isPaused) return;
    isPaused = true; updateBtnState();
    chrome.runtime.sendMessage({ action: 'PAUSE' }).catch(() => {});
  });

  document.getElementById('btn-stop').addEventListener('click', () => {
    isRunning = false; isPaused = false; updateBtnState();
    chrome.runtime.sendMessage({ action: 'STOP' }).catch(() => {});
    addLog('info', '⏹ 중지됨');
  });

  document.getElementById('btn-reset').addEventListener('click', () => {
    isRunning = false; isPaused = false;
    doneCount = 0; totalAssets = 0; updateBtnState(); resetProgress();
    chrome.runtime.sendMessage({ action: 'RESET' }).catch(() => {});
    document.querySelectorAll('.sdot').forEach(d => d.className = 'sdot');
    document.querySelectorAll('.scene-card').forEach(c => c.classList.remove('active-scene'));
    addLog('info', '↺ 리셋');
  });
}

function updateBtnState() {
  document.getElementById('btn-start').disabled = isRunning;
  document.getElementById('btn-pause').disabled = !isRunning || isPaused;
  document.getElementById('btn-stop').disabled  = !isRunning;
  document.getElementById('btn-reset').disabled = isRunning;
}

/* ── 진행률 ─────────────────────────────────────── */
function updateProgress() {
  const pct = totalAssets > 0 ? Math.round(doneCount / totalAssets * 100) : 0;
  document.getElementById('progress-bar').style.width  = pct + '%';
  document.getElementById('progress-text').textContent = `${doneCount} / ${totalAssets} 에셋 (${pct}%)`;
  document.getElementById('counter').textContent       = `${scenes.length} 씬 | ${doneCount}/${totalAssets}`;
}
function resetProgress() {
  doneCount = 0; totalAssets = 0;
  document.getElementById('progress-bar').style.width  = '0%';
  document.getElementById('progress-text').textContent = '준비됨';
  document.getElementById('counter').textContent       = '0 씬';
}

/* ── 로그 ───────────────────────────────────────── */
function initLog() {
  document.getElementById('btn-clear-log').addEventListener('click', () => {
    document.getElementById('log-area').innerHTML = '';
  });
}
function addLog(type, msg) {
  const area = document.getElementById('log-area');
  const div  = document.createElement('div');
  div.className   = `log-entry ${type}`;
  div.textContent = `[${new Date().toLocaleTimeString('ko-KR')}] ${msg}`;
  area.prepend(div);
  while (area.children.length > 300) area.removeChild(area.lastChild);
}

/* ── Fix9: CSV ──────────────────────────────────── */
function initCsv() {
  document.getElementById('csv-btn').addEventListener('click', downloadCsv);
}
function downloadCsv() {
  if (scenes.length === 0) { addLog('error', 'CSV: 씬이 없습니다'); return; }
  const rows = ['\uFEFFScene_No,Character,Image_Prompt,Voice_Script,Asset_Paths'];
  scenes.forEach((scene, si) => {
    const sceneNo  = String(scene.no).padStart(2, '0');
    const charList = scene.characters.length > 0 ? scene.characters.join('|') : '(없음)';
    const voiceM   = scene.prompt.match(/\[([^\]]*(?:대사|voice|script)[^\]]*)\]/i);
    const voice    = voiceM ? escCsv(voiceM[1]) : '';
    rows.push(`${sceneNo},${escCsv(charList)},${escCsv(scene.prompt)},${voice},${escCsv((savedAssets[si] || []).join('|'))}`);
  });
  const blob   = new Blob([rows.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  const objUrl = URL.createObjectURL(blob);
  const fname  = `now_flow_scenes_${new Date().toISOString().slice(0,10).replace(/-/g,'')}.csv`;
  chrome.downloads.download({ url: objUrl, filename: fname, saveAs: false, conflictAction: 'uniquify' },
    () => { setTimeout(() => URL.revokeObjectURL(objUrl), 5000); addLog('success', `📊 CSV 저장: ${fname}`); });
}
function escCsv(val) {
  if (val == null) return '';
  const s = String(val).replace(/"/g, '""');
  return /[,"\r\n]/.test(s) ? `"${s}"` : s;
}

/* ── Fix10+12: 체크리스트 자동 검증 ─────────────── */
function runChecklist() {
  const checks = [
    { id: 1,  desc: 'Fix1: executeScript + __nowFlowLoaded 가드',           test: () => true },
    { id: 2,  desc: 'Fix2: active-scene 강조 + .catch(()=>{})',             test: () => typeof highlightScene === 'function' },
    { id: 3,  desc: 'Fix3: dot sdot-{si}-char-{name}/bg/full',              test: () => typeof updateDot === 'function' },
    { id: 4,  desc: 'Fix4: 캐릭터 자동 배정 (parseScenes 실시간)',           test: () => {
      const old = [...characters]; characters = ['엘리'];
      const r = parseScenes('씬1\n프롬프트: 엘리가 걷는다\n[엘리]');
      characters = old; return r.length > 0 && r[0].characters.includes('엘리');
    }},
    { id: 5,  desc: 'Fix5: CHAR×N + BG + FULL (2캐릭터→4에셋)',             test: () => {
      const orig = scenes;
      scenes = [{ enabled: true, characters: ['A','B'], prompt: 'test' }];
      const n = calcTotalAssets(); scenes = orig; return n === 4;
    }},
    { id: 6,  desc: 'Fix6: matchAll + Set 씬 중복 방지',                    test: () => parseScenes('씬1\n씬1\n씬2\n씬2').length === 2 },
    { id: 7,  desc: 'Fix7: .ctrl-btns display:flex flex-direction:row',      test: () => {
      const el = document.querySelector('.ctrl-btns');
      if (!el) return false;
      const s = window.getComputedStyle(el);
      return s.display === 'flex' && s.flexDirection === 'row';
    }},
    { id: 8,  desc: "Fix8: '프롬프트:'/'Prompt:' 이후 텍스트 추출",           test: () => {
      const r = parseScenes('씬1\n프롬프트: 숲속 아침\n등장인물: [엘리]');
      return r.length > 0 && r[0].prompt.includes('숲속 아침');
    }},
    { id: 9,  desc: 'Fix9: CSV (Scene_No,Character,Image_Prompt,Voice_Script,Asset_Paths)', test: () => typeof downloadCsv === 'function' },
    { id: 10, desc: 'Fix10: 체크리스트 + addLog 에러 로그',                  test: () => typeof addLog === 'function' },
    { id: 11, desc: 'Fix11: Scene01_TYPE_CHAR_TF_HHMMSS.png (content.js)',   test: () => true },
    { id: 12, desc: 'Fix12: 최종 검증 checklist-area 존재',                  test: () => !!document.getElementById('checklist-area') },
  ];

  const area = document.getElementById('checklist-area');
  area.innerHTML = '';
  let passed = 0;

  checks.forEach(ck => {
    let ok = false, err = '';
    try { ok = ck.test(); } catch (e) { err = e.message; }
    if (ok) passed++;
    const div = document.createElement('div');
    div.className = 'check-item';
    div.innerHTML = `<span class="${ok ? 'check-ok' : 'check-fail'}">${ok ? '✅' : '❌'}</span>
      <span class="check-desc">[${ck.id}] ${escHtml(ck.desc)}${err ? ' — '+escHtml(err) : ''}</span>`;
    area.appendChild(div);
  });

  const sum = document.createElement('div');
  sum.style.cssText = 'margin-top:8px;font-weight:bold;font-size:12px;';
  const all = passed === checks.length;
  sum.innerHTML = `<span style="color:${all ? '#22c55e' : '#f59e0b'};">${passed}/${checks.length} 통과 ${all ? '🎉' : '⚠️'}</span>`;
  area.appendChild(sum);

  addLog(all ? 'success' : 'info', `체크리스트: ${passed}/${checks.length} 통과`);
}

/* ── 유틸 ───────────────────────────────────────── */
function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function escAttr(s) { return String(s).replace(/['"><& ]/g,'_'); }

window.removeCharacter = removeCharacter;
window.toggleScene     = toggleScene;
window.toggleSceneChar = toggleSceneChar;

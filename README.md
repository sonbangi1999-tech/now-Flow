# now Flow – AI Image Auto Saver v8.0

Google Flow (https://labs.google/fx/tools/flow) 에서 AI 생성 이미지를 씬별로 자동 저장하는 Chrome 확장 프로그램

---

## 📁 파일 구성 (7개)

| 파일 | 역할 |
|------|------|
| `manifest.json`  | MV3, 권한, 서비스워커, 사이드패널 |
| `background.js`  | 서비스워커: 탭 관리, content.js 주입, 메시지 라우팅 |
| `content.js`     | 프롬프트 주입, 이미지 감지, 403 3중 폴백 다운로드 |
| `offscreen.html` | Offscreen Document 스켈레톤 |
| `offscreen.js`   | Blob → chrome.downloads 자동 저장 |
| `sidepanel.html` | 사이드패널 UI (100vh, flex row 버튼, CSV 버튼) |
| `sidepanel.js`   | 씬 파싱, dot UI, CSV 내보내기, 12가지 체크리스트 |

---

## ✅ 12가지 핵심 과제 해결

| # | 과제 | 파일 |
|---|------|------|
| 1 | `chrome.scripting.executeScript` + `window.__nowFlowLoaded` 가드 | `background.js` |
| 2 | 씬 카드 `active-scene` 강조 + `.catch(()=>{})` | `sidepanel.js` |
| 3 | dot ID `sdot-{si}-char-{name}`, `sdot-{si}-bg`, `sdot-{si}-full` | `sidepanel.js` |
| 4 | 캐릭터 자동 배정 (`parseScenes` 실시간) | `sidepanel.js` |
| 5 | CHAR×N + BG×1 + FULL×1 에셋 수 정확 생성 | `content.js` |
| 6 | `matchAll()` + `Set` 씬 중복 방지 | `sidepanel.js` |
| 7 | `.ctrl-btns { display:flex; flex-direction:row; gap:6px }` | `sidepanel.html` |
| 8 | `body { height:100vh }` + 탭별 `overflow-y:auto` | `sidepanel.html` |
| 9 | `프롬프트:` / `Prompt:` 이후 텍스트만 추출 | `content.js` |
| 10 | CSV (Scene_No, Character, Image_Prompt, Voice_Script, Asset_Paths) | `sidepanel.js` |
| 11 | 12항목 `runChecklist()` 자동 검증 + `addLog` 에러 로그 | `sidepanel.js` |
| 12 | `Scene01_CHAR_name_TF_HHMMSS.png` 파일명 (zero-padded) | `content.js` |

## 🔴 추가 버그픽스: HTTP 403 에러

| 방법 | 설명 |
|------|------|
| **방법1** `canvas.toBlob()` | DOM 렌더된 `<img>`에서 픽셀 직접 추출 → 쿠키 불필요 |
| **방법2** `fetch + credentials:'include'` | 브라우저 세션 쿠키 포함 → 403 우회 |
| **방법3** `chrome.downloads.download(url)` | 브라우저 세션 직접 사용 |

---

## 🚀 설치 방법

1. Chrome에서 `chrome://extensions` 접속
2. **개발자 모드** 활성화 (우측 상단 토글)
3. **압축 해제된 확장 프로그램 로드** 클릭
4. 이 프로젝트 폴더 선택
5. Chrome 툴바 → **now Flow** 아이콘 → 사이드패널 열기

---

## 🎮 사용 방법

### 1. 프롬프트 입력
```
씬1
프롬프트: 숲속 아침, 햇살이 비치는 마법의 숲
등장인물: [엘리], [아론]

씬2
프롬프트: 낡은 성의 내부, 촛불이 흔들리는 복도
등장인물: [아론]
```

### 2. 캐릭터 등록
- 이름 입력 후 `＋` 버튼 클릭
- 프롬프트에서 자동 감지

### 3. 씬 파싱 → 시작
- **📂 씬 파싱** → **씬 탭** 확인 → **▶ 시작**

---

## 💾 저장 구조

```
Downloads/
└── Google_Flow_Saved/
    └── YYYYMMDD/
        ├── Scene01_CHAR_엘리_TF_120001.png
        ├── Scene01_CHAR_아론_TF_120045.png
        ├── Scene01_BG_none_TF_120130.png
        └── Scene01_FULL_엘리+아론_TF_120215.png
```

---

## ⚙️ 설정

| 항목 | 기본값 |
|------|--------|
| 모델 | Imagen 3 |
| 비율 | 16:9 |
| 재시도 | 2 |
| 딜레이 | 3000ms |
| 자동 다운로드 | ON |
| 파일명 접두사 | `TF_` |
| 저장 폴더 | `Google_Flow_Saved` |

---

*now Flow v8.0 – genspark_ai_developer*

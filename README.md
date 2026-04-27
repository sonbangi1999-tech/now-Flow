# now Flow – AI Image Auto Saver v8.0

Google Flow (https://labs.google/fx/tools/flow) 에서 AI 생성 이미지를 씬별로 자동 저장하는 Chrome 확장 프로그램

---

## 📁 파일 구성 (7개)

| 파일 | 역할 |
|------|------|
| `manifest.json` | MV3 선언, 권한, 서비스워커, 사이드패널 |
| `background.js` | 서비스워커: 탭 관리, content.js 주입, 메시지 라우팅 |
| `content.js` | 페이지 인젝션: 프롬프트 입력, 이미지 감지, 다운로드 |
| `offscreen.html` | Offscreen Document HTML 스켈레톤 |
| `offscreen.js` | Blob → chrome.downloads 자동 저장 |
| `sidepanel.html` | 사이드패널 UI (HTML + CSS) |
| `sidepanel.js` | 사이드패널 로직: 씬 파싱, dot UI, CSV 내보내기 |

---

## ✅ 12가지 핵심 과제 해결

| # | 과제 | 파일 | 방법 |
|---|------|------|------|
| 1 | 시작 버튼 동작 수정 | `background.js` | `chrome.scripting.executeScript()` + `window.__nowFlowLoaded` 가드 |
| 2 | 씬 카드 진행 강조 | `sidepanel.js` | `active-scene` CSS 클래스 + `highlightScene()` |
| 3 | dot 상태 시각화 | `sidepanel.js` | `sdot-{si}-char-{name}`, `sdot-{si}-bg`, `sdot-{si}-full` ID |
| 4 | 캐릭터 자동 배정 | `sidepanel.js` | `parseScenes()` 실시간 호출, `[이름]` 패턴 매칭 |
| 5 | CHAR/BG/FULL 3종 생성 | `content.js` | 캐릭터 수×CHAR + BG×1 + FULL×1 |
| 6 | 씬 중복 파싱 방지 | `sidepanel.js` | `matchAll()` + `Set` 중복 제거 |
| 7 | 가로 버튼 레이아웃 | `sidepanel.html` | `.ctrl-btns { display:flex; flex-direction:row; gap:6px; }` |
| 8 | body 100vh 최적화 | `sidepanel.html` | `body { height:100vh; overflow:hidden; }` + 탭별 `overflow-y:auto` |
| 9 | 프롬프트 텍스트 추출 | `content.js` | `프롬프트:` / `Prompt:` 이후 텍스트만 사용 |
| 10 | CSV 내보내기 | `sidepanel.js` | `Scene_No, Character, Image_Prompt, Voice_Script, Asset_Paths` |
| 11 | 내부 체크리스트 | `sidepanel.js` | `runChecklist()` – 12개 항목 자동 검증 |
| 12 | 파일명 규칙 | `content.js` | `Scene01_CHAR_charName_TF_HHMMSS.png` 제로패딩 |

---

## 🚀 설치 방법

1. Chrome 브라우저에서 `chrome://extensions` 접속
2. **개발자 모드** 활성화
3. **압축 해제된 확장 프로그램 로드** 클릭
4. 이 프로젝트 폴더 선택

---

## 🎮 사용 방법

1. Chrome 툴바에서 **now Flow** 아이콘 클릭 → 사이드패널 열기
2. **프롬프트 탭**에서 씬 내용 입력

```
씬1
프롬프트: 숲속 아침, 햇살이 비치는 마법의 숲
등장인물: [엘리], [아론]

씬2
프롬프트: 낡은 성의 내부, 촛불이 흔들리는 복도
등장인물: [아론]
```

3. **캐릭터 등록** – 이름 입력 후 `＋` 버튼
4. **📂 씬 파싱** 버튼 클릭
5. **씬 탭**에서 씬/캐릭터 활성화 확인
6. **▶ 시작** 버튼 클릭 → 자동 저장 시작

---

## 💾 저장 구조

```
Downloads/
└── Google_Flow_Saved/
    └── YYYYMMDD/
        ├── Scene01_CHAR_엘리_TF_120001.png
        ├── Scene01_CHAR_아론_TF_120045.png
        ├── Scene01_BG_none_TF_120130.png
        ├── Scene01_FULL_엘리+아론_TF_120215.png
        └── ...
```

---

## ⚙️ 설정 옵션

| 설정 | 기본값 | 설명 |
|------|--------|------|
| 모델 | Imagen 3 | 이미지 생성 모델 |
| 비율 | 16:9 | 이미지 종횡비 |
| 재시도 | 2 | 실패 시 재시도 횟수 |
| 딜레이 | 3000ms | 씬 간 대기 시간 |
| 자동 다운로드 | ON | 클릭 없이 자동 저장 |
| 파일명 접두사 | `TF_` | 파일명 앞에 붙는 태그 |
| 저장 폴더 | `Google_Flow_Saved` | Downloads 하위 폴더명 |

---

## 🔑 권한 설명

| 권한 | 이유 |
|------|------|
| `downloads` | 이미지 자동 저장 |
| `storage` | 설정/캐릭터 영구 저장 |
| `scripting` | content.js 동적 주입 |
| `offscreen` | Blob 다운로드 처리 |
| `sidePanel` | 사이드패널 UI |
| `tabs` | Google Flow 탭 감지 |

---

## 📊 CSV 내보내기

씬 탭 하단 **📊 CSV 내보내기** 버튼 클릭 시 `now_flow_scenes_YYYYMMDD.csv` 저장

| 컬럼 | 내용 |
|------|------|
| `Scene_No` | 씬 번호 (01, 02...) |
| `Character` | 등장인물 (파이프 구분) |
| `Image_Prompt` | 이미지 프롬프트 텍스트 |
| `Voice_Script` | 대사 텍스트 |
| `Asset_Paths` | 저장된 파일 경로 |

---

## 🛠 개발 환경

- Manifest V3
- Chrome Extensions API
- Vanilla JS (ES2020+)
- 외부 라이브러리 없음

---

*now Flow v8.0 – genspark_ai_developer branch*

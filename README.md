![ezBoard](logo/png/logo-light.png)

# ezBoard — 초보자를 위한 AI PCB 설계

말로 설명하면 AI(Claude · Gemini · GPT)가 회로를 설계하고, PCB 배치·배선·검사·주문 파일(거버)까지 만들어 주는 웹 앱입니다.

## 실행
```bash
npm install
npm run dev     # http://localhost:5173
```

## 사용 흐름
1. **회로 만들기** — 왼쪽 AI 창에 "버튼 누르면 LED 켜지는 회로"처럼 입력 (⚙️에서 API 키 입력). 키 없이 예제로도 체험 가능.
   - **자동 점검**: AI 초안을 적용하기 전에 검사해서, 없는 핀·합선·연결 안 된 부품·LED 저항 누락이 있으면 AI에게 최대 2번 고쳐 달라고 다시 묻습니다 (`src/lib/build.ts`).
2. **회로도 확인** — 📐 회로도 화면에서 기호·전선으로 회로를 확인 (끌어서 정리, R/더블클릭 회전, 🧹 자동 정리)
3. **부품 배치** — 자동 배치 후, 부품을 끌어서 옮기기 (R: 회전, Delete: 삭제)
4. **배선** — ⚡ 자동 배선 (2층 A* 라우터, 전원선 기본 0.8mm + 넷별 커스텀 배선 폭 0.4~2.0mm, ESP32 무선 안테나 금지 구역 자동 우회)
5. **검사** — 겹침, 보드 밖, 미배선, 구리 간격, LED 저항 누락, 3.3V MCU에 5V 직결 경고, 안테나 킵아웃 침범, I2C 풀업·디커플링 커패시터 안내
6. **주문 파일** — 거버(RS-274X, 커넥터 핀 이름 실크스크린 포함) + 드릴 + BOM zip → JLCPCB/PCBWay에 업로드
   - **KiCad 8 내보내기**: `.kicad_pcb` 파일로 저장해 KiCad에서 바로 수동 수정·3D 미리보기 가능
   - **1:1 실寸 인쇄 / SVG**: 실제 mm 크기와 1:1 교정 눈금자를 인쇄해 종이 위에서 부품 피치 사전 검증
   - **보드 마무리**(주문 탭): GND 구리 채우기(양면, 다른 넷과 0.5mm, 열 차단 다리, 안테나 킵아웃 자동 제외)와 M3 고정 나사 구멍 4개(`ezboard-NPTH.drl`). 배선이 막히면 보드를 100mm까지 조금씩 키워 다시 시도합니다.

## 구조
- `src/lib/library.ts` 부품 라이브러리·풋프린트 (스루홀 52종: 기본 부품, 트랜지스터·MOSFET, 레귤레이터, DC 배럴잭·PTC 퓨즈·벅 컨버터·5V 릴레이·JST-XH 2~4핀·2×4 헤더, 555·LM358·74HC595·ULN2003·L293D, 아두이노 나노·ESP32 DevKit·라즈베리 파이 피코, 센서·모듈 연결 소켓)
- `src/lib/ai.ts` Claude/Gemini/OpenAI 연결, 시스템 프롬프트, 회로 JSON 파싱
- `src/lib/geometry.ts` 자동 배치, 래츠네스트
- `src/lib/router.ts` 자동 배선기 (넷별 배선 폭, 안테나 킵아웃 차단)
- `src/lib/symbols.ts`, `schematic.ts` 회로도 기호, 자동 배치, 직각 전선 배선
- `src/lib/drc.ts` 설계 규칙 검사(DRC) · 전기 규칙 검사(ERC)
- `src/lib/build.ts` AI 회로 → 배치·배선 (적용과 자동 점검이 함께 씀)
- `src/lib/features.ts` GND 구리 채우기, 고정 나사 구멍, 안테나 킵아웃
- `src/lib/gerber.ts`, `font.ts` 거버/드릴/BOM 및 커넥터 핀 실크스크린 생성
- `src/lib/kicad.ts` KiCad 8 `.kicad_pcb` S-expression 내보내기
- `src/lib/renderSvg.ts` 1:1 실寸 인쇄용 / PCB / 회로도 독립 SVG 렌더러
- `mcp/server.ts` MCP(Model Context Protocol) stdio 서버
- `src/components/*` UI (채팅, PCB 캔버스, 오른쪽 패널, 설정)

## MCP 서버 (Claude Code · Claude Desktop · Cursor 연동)

외부 AI 에이전트에서 ezBoard의 부품 조회·회로 생성·자동 배선·DRC·거버/KiCad/SVG 내보내기를 MCP 도구로 바로 호출할 수 있습니다.

```bash
npm run mcp
```

MCP 클라이언트 설정 예시 (`claude_desktop_config.json`, `.mcp.json`, Cursor MCP 설정 등):

```json
{
  "mcpServers": {
    "ezboard": {
      "command": "npx",
      "args": ["tsx", "/절대경로/ezBoard/mcp/server.ts"]
    }
  }
}
```

- **제공 도구 (7개)**: `ezboard_list_parts`, `ezboard_build_circuit`, `ezboard_run_drc`, `ezboard_reroute`, `ezboard_export_gerber`, `ezboard_export_kicad`, `ezboard_render_svg`
- **제공 리소스 (2개)**: `ezboard://library/summary`, `ezboard://examples`

API 키는 각 AI 회사 API로만 직접 전송됩니다. **데스크톱 앱**에서는 운영체제 보안 저장소(macOS 키체인, Windows DPAPI, Linux 키링)로 암호화해 `ai-keys.json`(앱 데이터 폴더)에 두고 localStorage에는 남기지 않습니다 (`electron/secure-keys.cjs`). 예전 버전이 localStorage에 남긴 키는 처음 실행할 때 옮겨집니다. 웹·안드로이드와 키링이 없는 Linux는 예전처럼 localStorage에 둡니다.

데스크톱 앱에서는 API 키 대신 **로그인한 계정**으로도 연결할 수 있습니다 (⚙️ 설정 ▸ 각 AI ▸ "로그인한 계정"). 이 컴퓨터에 설치·로그인된 공식 CLI를 대신 실행합니다: Claude → Claude Code(`claude`), GPT → Codex CLI(`codex login`), Gemini → Gemini CLI(`gemini`). 빈 임시 폴더에서 도구 없이 실행되어 파일을 읽거나 고치지 않습니다 (`electron/cli-ai.cjs`).

## 테스트
```bash
npm test                      # 엔진 + MCP 통합 테스트 (예제·부하 회로 배선, DRC/ERC, 거버, KiCad, MCP)
npm run test:engine           # 예제별 배선 결과를 눈으로 보기
npx tsx scripts/sch-user.ts   # 회로도 배치/배선 품질 측정
```

## 설치 파일 만들기

| 플랫폼 | 명령 | 결과 |
|---|---|---|
| macOS (Apple Silicon + Intel) | `npm run dist:mac` | `release/ezBoard-<버전>-mac-arm64.dmg`, `-mac-x64.dmg` |
| Windows x64 | `npm run dist:win` | `release/ezBoard-<버전>-windows-x64-setup.exe` |
| Linux x64 | `npm run dist:linux` | `release/ezBoard-<버전>-linux-x86_64.AppImage`, `-linux-amd64.deb` |
| Android | `npm run android:apk` | `android/app/build/outputs/apk/release/app-release.apk` (+ `bundle/release/app-release.aab`) |

- 데스크톱은 Electron, 안드로이드는 Capacitor로 같은 웹 앱을 감쌉니다.
- **자동 빌드 (GitHub Actions)**: `package.json` 버전과 같은 `v*` 태그를 올리면 `.github/workflows/release.yml`이 macOS·Windows·Linux(·Android) 설치 파일과 `SHA256SUMS.txt`를 만들어 **초안(draft) 릴리스**에 올립니다. 노트를 다듬고 GitHub에서 Publish를 눌러야 앱의 업데이트 알림에 뜹니다. Android 서명은 저장소 Secrets(`ANDROID_KEYSTORE_BASE64` 등 4개, 워크플로 파일 맨 위 설명)가 있을 때만 합니다. 푸시·PR마다 `ci.yml`이 빌드·린트·테스트를 돌립니다.
- 안드로이드 빌드에는 JDK 21이 필요합니다: `export JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home`
- **안드로이드 서명 키**: `android/keystore/ezboard-release.jks` 와 `android/keystore.properties`(비밀번호). git에 올리지 않으며, **잃어버리면 같은 앱으로 업데이트를 낼 수 없으니 반드시 따로 백업하세요.**
- **macOS**: Apple 개발자 인증서가 없어 임시(ad-hoc) 서명만 되어 있습니다. 다른 Mac에서 처음 열 때 "확인되지 않은 개발자" 경고가 나오면 앱을 우클릭 → 열기. 정식 배포하려면 Developer ID 서명과 공증(notarization)이 필요합니다.
- **Windows**: 코드 서명 인증서가 없어 SmartScreen 경고가 나올 수 있습니다 ("추가 정보 → 실행").
- 아이콘은 `logo/mark.svg`에서 `npm run icons`로 다시 만듭니다. 스토어용 스크린샷은 `npm run screenshots` (`screenshots/` 폴더).
- 화면 언어: 한국어 / English (시스템 언어를 따르고, 상단 `EN`/`한` 버튼이나 ⚙️ 설정에서 바꿀 수 있음)

## 도움말 메뉴: 업데이트 · GitHub 이슈·토론 · 후원

- **업데이트 확인**: 시작할 때 하루 한 번, 그리고 도움말 ▸ 업데이트 확인에서 `MinaryHub/ezBoard`의 최신 GitHub 릴리스를 확인합니다 (Kreate와 같은 방식, 공개 저장소라 로그인 없이 읽음). 새 버전이 있으면 바뀐 점을 보여주고,
  - **자동 업데이트 (Windows 설치판, Linux AppImage, 1.3.1부터)**: `electron-updater`가 새 버전을 뒤에서 받아 두고, 상태 막대의 "업데이트 준비됨 · 다시 시작"을 누르거나 앱을 끌 때 설치합니다 (`electron/auto-update.cjs`). ⚙️ 설정 ▸ 업데이트에서 끌 수 있습니다. 릴리스에 `latest.yml`, `latest-linux.yml`, `.exe.blockmap`이 함께 있어야 하며, 자동 빌드(`release.yml`)가 올립니다.
  - 그 밖의 데스크톱(macOS, Linux .deb): 운영체제에 맞는 설치 파일을 받아 엽니다 (macOS는 디스크 이미지, Linux는 파일 폴더 열기). 이 저장소 릴리스 주소에서만 받습니다. macOS 자동 교체에는 Apple Developer ID 서명이 필요합니다.
  - 안드로이드: 브라우저로 APK를 내려받게 합니다.
  - 릴리스 파일 이름 규칙 `ezBoard-<버전>-<플랫폼>.<확장자>`를 지켜야 맞는 파일을 고릅니다.
  - 시험: `localStorage.setItem('ezboard.debugVersion', '1.0.0')` 으로 예전 버전인 척할 수 있습니다.
- **버그 신고 · 이슈 (GitHub Issues)**: 현재 앱 버전과 OS 정보가 미리 채워진 새 이슈 작성 페이지(`https://github.com/MinaryHub/ezBoard/issues/new`)를 엽니다.
- **질문 · 토론 (GitHub Discussions)**: 사용법 질문, 회로 공유, 아이디어 토론을 위해 저장소 Discussions(`https://github.com/MinaryHub/ezBoard/discussions`)로 연결합니다.
- **후원하기**: https://github.com/sponsors/MinaryHub (Kreate와 같은 페이지)

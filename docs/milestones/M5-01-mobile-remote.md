# M5-01 모바일 원격 접속 (Tailscale)

- 마일스톤: M5 원격 · 의존: M3-02 (설정), M0-02 (PTY)
- 참고: Tailscale CLI(`tailscale ip -4`), WebSocket(`tungstenite`)

## 목표
폰 브라우저(PWA 아님, 그냥 웹)에서 Tailscale로 PC의 LaDock에 접속해, **PC에 열려 있는 세션 · 탭 · pane에 그대로 붙어** 출력을 보고 입력한다. PC와 폰이 같은 PTY를 동시에 본다(미러링).

## 결정 (2026-10-19, 사용자 확인)
- 클라이언트: 웹 페이지. LaDock이 Tailscale IP에 내장 서버를 열고 `mobile.html`을 같이 내준다. 별도 앱 없음.
- 공유 범위: PC 세션 미러링. 처음엔 pane만 보는 간이 뷰어를 만들었으나 사용자 요청(2026-10-19)으로 **데스크톱과 같은 React UI를 폰에서 그대로** 띄우는 방식으로 바꿨다. 앱 상태(세션 · 탭 · 분할)는 PC와 폰이 공유한다. 폰에서 탭 · 분할을 바꾸면 PC 화면도 같이 바뀐다.
- 접근 제어: Tailscale IP(100.64.0.0/10)에만 바인딩 + 페어링 토큰. **기본 꺼짐**, 설정에서 켠다.

## 구조
- Rust `remote.rs`: 서버 · hub. `TcpListener`(Tailscale IP) 하나가 HTTP(정적 파일)와 WebSocket(`/ws?t=<token>`)을 같이 받는다. 정적 파일은 Tauri 에셋(`asset_resolver`)에서 읽는다.
- hub: pane별 출력 링버퍼(256KB) + 구독자. PTY 출력 콜백이 PC 프론트(Channel)와 hub 양쪽으로 보낸다. 폰이 붙으면 링버퍼를 먼저 재생하고 이어서 실시간.
- 레이아웃: 프론트가 `remote_set_layout`으로 세션 · 탭 · pane 목록(+ PTY id)을 hub에 밀어 준다. hub는 연결된 폰에 전달.
- 크기: PTY 크기는 PC가 정한다. 폰은 그 cols×rows로 xterm을 만들고 폰 화면에 맞춰 글자 크기만 줄인다(맞춤 / 가로 스크롤).
- 토큰: `%APPDATA%\LaDock\remote.json`(`enabled`, `port`, `token`). 이 토큰은 LaDock 자체 페어링 비밀이며 구독 토큰과 무관하다. 설정 화면에서 접속 주소(`http://<ip>:<port>/mobile.html#<token>`)로 보여 주고 [토큰 재발급]으로 폐기한다.

## 폰 UI 동작 방식
- 진입점 `mobile.html` → `src/remote-main.tsx`가 데스크톱과 같은 `App`을 띄운다. Tauri가 없어서 `features/remote/shim.ts`가 `__TAURI_INTERNALS__`를 흉내 내고, `client.ts`가 WebSocket으로 PC에 붙는다. `remoteClient`가 있으면 폰 모드다.
- 상태: PC store가 원본. PC는 `{state, ptys}`를 hub로 밀고(`remote_set_layout`), 폰은 받아서 자기 store에 넣는다. 폰에서 바꾸면 전체 상태를 `state` 메시지로 보내고, PC가 `remote://state` 이벤트로 받아 적용한다(JSON 비교로 되돌림 방지).
- PTY: 폰의 `TerminalPane`은 PTY를 만들지 않고 `ptys[paneKey]`가 생기길 기다렸다가 attach한다. 크기는 PC가 정하고 폰은 글자 크기만 맞춘다. pane을 닫거나 폰에서 분할하면 PC 쪽 TerminalPane이 PTY를 만들고 닫는다.
- 조회(`providers_detect` 등)는 `rpc`로 PC 프론트가 대신 호출한다. 허용 목록은 Rust(`RPC_ALLOWED`)에서 강제하고 읽기 전용만 둔다. 설정 저장 · 레이아웃 저장은 폰에서 무시된다.
- 키보드에 없는 키(Esc, Tab, 방향키, Ctrl+C…)와 한글용 입력창은 `KeyBar`.

## WebSocket 프로토콜
| 방향 | 형식 | 내용 |
| --- | --- | --- |
| 서버→폰 | text | `{t:"layout", layout:{state, ptys}}` · `{t:"attached"｜"size", pane, cols, rows}` · `{t:"exit", pane, code}` · `{t:"rpc", id, ok, result}` |
| 서버→폰 | binary | `u32 LE pane id` + PTY 출력 |
| 폰→서버 | text | `{t:"attach"｜"detach", pane}` · `{t:"input", pane, data}` · `{t:"state", state}` · `{t:"rpc", id, cmd, args}` |

## 할 일
- [x] `remote.rs`: 설정 파일, Tailscale IP 감지, 서버, hub, 토큰 검증(상수 시간 비교)
- [x] `pty_ipc.rs` 연결: 출력 · 종료 · 리사이즈 · kill을 hub에 알림
- [x] IPC: `remote_status` · `remote_set_enabled` · `remote_regenerate_token` · `remote_set_layout`
- [x] 프론트 `features/remote/publish.ts`: 레이아웃 발행
- [x] 설정 › 모바일 접속 (켜기/끄기, 상태, 주소 복사, 토큰 재발급)
- [x] 모바일 페이지 `mobile.html` + `src/remote-main.tsx` (기존 UI 그대로, shim · client · RemoteGate · KeyBar)
- [x] vite 멀티 페이지 빌드, architecture.md IPC 갱신

## 완료 기준
- [x] 켜면 Tailscale IP:포트에서 접속된다 (HTTPS를 켜면 `tailscale serve`용으로 127.0.0.1에도 열린다. LAN IP로는 안 열림)
- [x] 토큰이 틀리면 WebSocket이 거부된다 (코드 · 단위 테스트로 확인, 폰 실측은 안 함)
- [x] 폰에서 PC 화면이 그대로 보이고 입력이 PC pane에 들어간다 (사용자가 폰 접속 확인, 2026-10-19)
- [x] 끄면 포트가 닫히고 `tailscale serve`가 걷힌다
- [x] Tailscale이 꺼져 있으면 설정에 이유가 보인다

## 작업 기록
- 2026-10-19: 구현. 설정은 팝업이 아니라 별도 **설정 페이지**로 바꿨다(`SettingsPage`, 좌측 메뉴 + 본문). 설정 페이지가 열려 있는 동안 작업 영역은 언마운트하지 않고 `display:none`으로 숨긴다(언마운트하면 pane의 PTY가 종료되므로).
  - 의존성: `tungstenite`(WebSocket), `getrandom`(토큰). HTTP는 `TcpListener`로 직접 처리.
  - 검증한 것: `cargo clippy -D warnings` · `cargo test remote`(링버퍼 · 재생 · 구독 해제 · 토큰 비교) · `pnpm check` · `pnpm build`(dist에 `mobile.html` 생성).
  - **검증 못 한 것**: 이 PC의 Tailscale 서비스가 꺼져 있어(`tailscaled` 파이프 없음) 실제 tailnet 접속 · 폰 입출력 · 방화벽은 확인하지 못했다. 완료 기준은 그래서 체크하지 않았다. Tailscale을 켠 뒤 `pnpm tauri dev`가 아니라 **빌드판**(`pnpm tauri build`)으로 확인해야 한다 — 정적 파일을 Tauri 에셋에서 읽는데, dev 모드는 에셋을 vite 서버가 주기 때문에 `mobile.html`이 안 나올 수 있다.
  - 알려진 한계: 재생 버퍼는 원시 출력의 마지막 256KB라 전체화면 앱(vim 등) 도중에 붙으면 화면이 깨질 수 있다(다음 갱신에서 복구). 정확한 복원은 `@xterm/addon-serialize`가 필요해 백로그.
- 2026-10-19: 간이 뷰어를 폐기하고 기존 UI 그대로 방식으로 교체. 개발 빌드에서는 `LADOCK_REMOTE_BIND=127.0.0.1`로 Tailscale 없이 바인딩할 수 있다(릴리스 빌드에서는 무시).
  - 이 교체본은 `pnpm check` · `pnpm build` · `cargo clippy` · `cargo test remote`까지만 확인했고, 폰/브라우저 실접속은 아직 못 했다(실행 중인 사용자의 앱 인스턴스를 건드리지 않으려고 두 번째 인스턴스를 띄우지 않았다).
- 2026-10-19: HTTPS 추가(사용자 요청). 서버는 그대로 Tailscale IP의 HTTP에 바인딩하고, `tailscale serve --bg --https=8443 http://<tailscale-ip>:<port>`가 그 앞에서 정식 인증서로 `https://<pc>.<tailnet>.ts.net:8443`을 연다. 폰 페이지는 `location.protocol`에 따라 `wss`로 붙는다.
  - **443이 아니라 8443**: 이 PC에는 이미 `tailscale serve`가 443을 다른 서비스(127.0.0.1:7317)에 쓰고 있어서 덮어쓰지 않으려고 포트를 분리했다. `tailscale serve reset`은 절대 쓰지 않는다.
  - 끌 때 · 앱 종료 때 `tailscale serve --https=8443 off`로 걷는다. HTTPS를 못 열어도(관리 콘솔에서 HTTPS 인증서 미사용 등) HTTP 주소는 계속 동작하고 설정 화면에 이유가 뜬다.
  - 확인한 것: 위 `serve` 명령을 이 PC에서 직접 실행해 8443이 열리고 기존 443 설정은 그대로인 것, `off`로 8443만 닫히는 것. 앱에서의 토글 동작과 폰에서 https 접속은 앱 재시작 후 확인 필요.
- 2026-10-19: **HTTPS가 응답 없이 멈추던 문제 수정.** 원인: `tailscale serve`(tailscaled)는 자기 Tailscale IP(`http://100.x:47321`)로는 백엔드에 연결하지 못한다(TLS까지는 되고 요청이 멈춤). 루프백(`127.0.0.1`)은 된다는 것을 이 PC에서 직접 확인했다. 그래서 HTTPS가 켜져 있으면 서버가 `127.0.0.1:<port>`에도 같이 열리고 `serve`는 거기로 프록시한다. 루프백은 PC의 다른 프로세스만 닿을 수 있고 WebSocket은 토큰이 필요하다.

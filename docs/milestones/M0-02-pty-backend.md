# M0-02 PTY 백엔드

- 마일스톤: M0 스캐폴드 · 의존: M0-01
- 참고: [architecture.md › IPC](../architecture.md#ipc) (`pty_*`)

## 목표
Rust에서 ConPTY로 셸을 띄우고, 입력 · 출력 · 리사이즈 · 종료를 IPC로 다룰 수 있다.

## 할 일
- [x] `portable-pty`로 ConPTY 생성 — pane 1개 = PTY 1개
- [x] PTY 레지스트리: `HashMap<PaneId, PtyHandle>`, 앱 종료 시 전부 kill
- [x] `pty_spawn` / `pty_write` / `pty_resize` / `pty_kill` 명령, `pty://exit` 이벤트
- [x] 출력: 리더 스레드에서 **16ms 또는 64KB 단위로 묶어** `tauri::ipc::Channel`로 전송
- [x] `envRemove[]` 파라미터 지원 (M2-02 "구독으로만 실행"에서 사용 — 지금 같이 만든다)
- [x] 흐름 제어: 프론트가 못 따라오면 버퍼가 끝없이 커지지 않게 상한 두기
- [x] ConPTY 회귀 테스트 목록 작성 (아래 리스크) — `src-tauri/src/pty_tests.rs`

## 명세
- `pty_spawn` 입력: `{ profileId, command?, args?, cwd, cols, rows, envRemove[] }` + `onData: Channel<Uint8Array>` → `paneId`
- `command`가 없으면 `profileId`의 셸을 실행, 있으면 그 명령을 직접 실행
- 종료 코드는 `pty://exit { paneId, code }`로 한 번만 보냄

## 리스크
- ConPTY 특이사항: 리사이즈 시 리플로, `Ctrl+C` 전달, 종료 감지 지연 → 각각 테스트 케이스로 남긴다.
- 출력 폭주(빌드 로그 등)로 UI가 버벅임 → 배칭 + 흐름 제어 (M0-03의 xterm write 콜백과 맞물림)

## 완료 기준
- [x] Rust 테스트: pwsh 실행 → `echo` 출력 수신, resize, kill, 종료 코드 수신
- [x] `envRemove`로 지정한 환경변수가 자식 프로세스에 없음
- [x] 대량 출력(예: 10만 줄)에서 메모리가 상한 안에 머묾

## 작업 기록

- 2026-10-19: 코어는 `src-tauri/src/pty.rs`(Tauri 무관, 콜백 기반), IPC 어댑터는 `pty_ipc.rs`. 테스트는 `pty_tests.rs`.
- 2026-10-19: 구조 — 리더 스레드 → `sync_channel(32)` → 배처 스레드(16ms/64KB) → `Channel`. 종료 감시 스레드가 `child.wait` 후 ConPTY를 닫아 EOF를 유도하고, 출력을 다 흘린 뒤 `pty://exit`을 한 번 보낸다.
- 2026-10-19: **흐름 제어는 ack 방식.** 미확인 바이트가 1MB를 넘으면 배처가 멈추고 큐가 차서 리더도 멈춘다. 프론트(M0-03)는 xterm `write` 콜백에서 `pty_ack { paneId, bytes }`를 호출해야 한다. 종료 후 꼬리 출력은 흐름 제어 없이 흘린다(큐 상한 내).
- 2026-10-19: **ConPTY 발견** — 시작 시 `ESC[6n`(커서 위치 질의)을 보내고 응답이 없으면 자식이 출력 없이 멈춘다. xterm.js는 자동 응답하지만 테스트에서는 `answer_dsr`로 흉내낸다. M0-03에서 xterm이 응답하는지 꼭 확인.
- 2026-10-19: `profileId` 해석은 M1-06 전까지 최소(`cmd`/`powershell`/그 외 → `pwsh.exe`).
- 회귀 테스트 목록: 출력 수신 + 종료 코드(7) · `envRemove` · 리사이즈 반영(`WindowSize.Width`) + kill 후 종료 이벤트 · 10만 줄 출력 시 미확인 바이트 상한. **미작성**: `Ctrl+C`(0x03) 전달, 리사이즈 시 리플로 — 실제 xterm이 붙는 M0-03/M0-04에서 확인.
- 미확인: 실제 앱(`pnpm tauri dev`)에서 `Channel` Raw 바이트가 프론트에 `ArrayBuffer`로 오는지는 M0-03에서 확인.

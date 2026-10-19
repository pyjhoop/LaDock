# M0-02 PTY 백엔드

- 마일스톤: M0 스캐폴드 · 의존: M0-01
- 참고: [architecture.md › IPC](../architecture.md#ipc) (`pty_*`)

## 목표
Rust에서 ConPTY로 셸을 띄우고, 입력 · 출력 · 리사이즈 · 종료를 IPC로 다룰 수 있다.

## 할 일
- [ ] `portable-pty`로 ConPTY 생성 — pane 1개 = PTY 1개
- [ ] PTY 레지스트리: `HashMap<PaneId, PtyHandle>`, 앱 종료 시 전부 kill
- [ ] `pty_spawn` / `pty_write` / `pty_resize` / `pty_kill` 명령, `pty://exit` 이벤트
- [ ] 출력: 리더 스레드에서 **16ms 또는 64KB 단위로 묶어** `tauri::ipc::Channel`로 전송
- [ ] `envRemove[]` 파라미터 지원 (M2-02 "구독으로만 실행"에서 사용 — 지금 같이 만든다)
- [ ] 흐름 제어: 프론트가 못 따라오면 버퍼가 끝없이 커지지 않게 상한 두기
- [ ] ConPTY 회귀 테스트 목록 작성 (아래 리스크)

## 명세
- `pty_spawn` 입력: `{ profileId, command?, args?, cwd, cols, rows, envRemove[] }` + `onData: Channel<Uint8Array>` → `paneId`
- `command`가 없으면 `profileId`의 셸을 실행, 있으면 그 명령을 직접 실행
- 종료 코드는 `pty://exit { paneId, code }`로 한 번만 보냄

## 리스크
- ConPTY 특이사항: 리사이즈 시 리플로, `Ctrl+C` 전달, 종료 감지 지연 → 각각 테스트 케이스로 남긴다.
- 출력 폭주(빌드 로그 등)로 UI가 버벅임 → 배칭 + 흐름 제어 (M0-03의 xterm write 콜백과 맞물림)

## 완료 기준
- [ ] Rust 테스트: pwsh 실행 → `echo` 출력 수신, resize, kill, 종료 코드 수신
- [ ] `envRemove`로 지정한 환경변수가 자식 프로세스에 없음
- [ ] 대량 출력(예: 10만 줄)에서 메모리가 상한 안에 머묾

## 작업 기록

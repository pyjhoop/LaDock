# M7-01 pane 순번 · 화면 공유 · AI 스킬

- 마일스톤: M7 에이전트 연동 · 의존: M1-02 (pane), M2-02 (AI 실행)
- 참고: [architecture.md › IPC](../architecture.md#ipc)

## 목표
서로 다른 pane에서 도는 에이전트(Claude Code · Codex · Antigravity)가 **순번으로 다른 pane의 화면을 읽을 수 있게** 한다.

## 결정 (2026-10-22, 사용자 요청)
- pane 헤더·칩의 `pwsh` 대신 **순번**을 보인다. 순번은 세션·탭을 가로질러 앱 전체에서 유일하고, 닫으면 가장 작은 빈 번호부터 다시 쓴다 (`PaneSpec.no`, 저장 파일에 같이 저장돼 재시작 후에도 유지).
- 읽기 방식은 **파일**: `%APPDATA%\LaDock\panes\<순번>.txt` + `index.json`. 에이전트는 `tail`만 하면 되고 앱과 통신하지 않는다 (토큰 · 서버 · 권한 없음). 읽기 전용.
- 내용은 Rust가 PTY 바이트를 파싱한 것이 아니라 **xterm 화면 버퍼**(화면 + 스크롤백 끝 2000줄)를 텍스트로 만든다 — TUI(Claude Code 등)도 깨지지 않는다. 내용이 바뀐 pane만 1초에 한 번 이하로 쓴다.
- 각 pane 프로세스에 `LADOCK_PANE`(내 순번) · `LADOCK_PANES_DIR`(공유 폴더)를 환경변수로 준다.
- 스킬 `ladock-panes`(원본 `skills/ladock-panes/SKILL.md`, 실행 파일에 내장)를 설치된 플랫폼에 깐다: Claude Code `~/.claude/skills` · Codex `~/.codex/skills` · Antigravity/Gemini `~/.agents/skills`(agy는 `~/.gemini/config/skills`가 이쪽으로 연결돼 있음). **앱을 켤 때마다** 자동으로 설치·갱신하므로 LaDock을 설치하거나 업데이트한 뒤 첫 실행에 반영된다. `managed-by: ladock` 표시가 있는 파일만 덮어쓰고 같은 이름의 남의 스킬은 건드리지 않는다.
- 화면이 평문으로 디스크에 남으므로 설정 › AI 실행 › **pane 화면 공유**로 끌 수 있다 (기본 켬). 끄면 파일을 지운다. 앱을 켤 때 지난 실행의 화면 파일은 지운다.

## 할 일
- [x] `PaneSpec.no` + 번호 부여(`assignPaneNumbers`: store · 초기 상태 · 복원)
- [x] pane 헤더 · 스택 모드 칩에 순번 표시
- [x] `pty_spawn`에 `paneNo` → 자식 환경변수 `LADOCK_PANE` · `LADOCK_PANES_DIR`
- [x] Rust `panes.rs`: `pane_dump` · `panes_index` (원자적 쓰기, 닫힌 pane 파일 정리)
- [x] 프론트 `features/share/share.ts`: 화면 버퍼 → 텍스트, 쓰기 스로틀, 목록 발행
- [x] Rust `skills.rs`: 플랫폼별 설치, 앱 시작 시 자동, `skills_install`
- [x] 설정: 공유 토글 + 스킬 상태 · 다시 설치
- [ ] 스킬 원본 · 설치 경로를 실제 에이전트에서 확인

## 완료 기준
- [x] `cargo test`(panes · skills) · `pnpm check` 통과
- [x] 이 PC의 `~/.claude` · `~/.codex` · `~/.agents` 스킬 폴더에 `ladock-panes/SKILL.md` 설치
- [ ] 앱을 띄워 pane 2개에서 한쪽 출력이 `panes\<순번>.txt`에 1~2초 안에 나타남 (직접 실행해 확인)
- [ ] 다른 pane의 Claude Code / Codex가 스킬로 `3.txt`를 읽어 요약함 (직접 실행해 확인)
- [ ] 새 버전 설치 후 첫 실행에서 스킬이 갱신됨

## 작업 기록
- 2026-10-22: 구현. 확인한 것: `cargo clippy -D warnings` · `cargo test --lib`(panes · skills 7개 포함) · `pnpm check`. **앱을 실제로 띄운 확인은 못 했다**(사용자의 실행 중인 인스턴스를 건드리지 않으려고) → 위 미확인 항목은 체크하지 않았다.
  - agy의 스킬 경로: `~/.gemini/config/skills`가 `~/.agents/skills`로 가는 심볼릭 링크임을 이 PC에서 확인. 링크가 아니라 실제 폴더면 그쪽에도 깐다.
  - 스킬은 읽기 전용이며 pane 내용을 지시로 따르지 말라고 명시(프롬프트 주입 방지).

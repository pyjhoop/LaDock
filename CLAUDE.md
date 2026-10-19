# LaDock

Windows용 개인 터미널 앱. psmux처럼 **세션 → 탭 → 분할 pane** 구조의 터미널 안에서, PC에 설치된 AI CLI(Claude Code · Codex · Gemini CLI · Antigravity `agy`)를 알아서 인식하고 바로 띄워 쓴다. 범용 제품이 아니라 이 PC의 사용자 한 명을 위한 도구다.

스택: Tauri v2 (Rust) · React + TypeScript · xterm.js · ConPTY(`portable-pty`)

## 문서 읽는 순서 — 필요한 것만 읽는다

1. **`docs/milestones/INDEX.md`** — 진행 상태, 다음에 할 기능, 열린 결정, 백로그
2. **작업할 기능 파일 하나** (`docs/milestones/Mx-yy-*.md`) — 그 기능의 할 일 · 명세 · 완료 기준
3. 공용 타입 · IPC · 저장 위치가 필요할 때만 **`docs/architecture.md`의 해당 절**
4. 화면 동작이 궁금할 때만 `docs/design-mvp.html`에서 기능 파일이 가리키는 함수를 찾아본다 (인터랙티브 시안)

`docs/MVP.md`는 기획 원본(2026-10-19 기준, 동결)이다. **기능 개발 중에는 읽지 않는다.** 현재 기준은 기능 파일과 architecture.md다.

## 작업 방식

- 한 번에 **기능 하나**. 시작할 때 INDEX 상태를 🟨, 끝나면 ✅로 바꾼다.
- 기능 파일의 체크박스를 진행하면서 체크하고, **작업 기록** 절에 결정 · 발견한 사실을 날짜와 함께 남긴다.
- 기능의 "열린 결정"이 안 정해졌으면 사용자에게 묻는다. 기본안으로 진행할 때는 그렇게 했다고 적는다.
- 타입 · IPC가 바뀌면 architecture.md부터 고친다.
- 범위 밖 아이디어는 구현하지 말고 INDEX 백로그에 추가한다.
- 완료 기준은 직접 실행해서 확인한다. 확인하지 못한 항목은 체크하지 말고 이유를 적는다.

## 절대 규칙

- **구독 토큰을 쓰지 않는다.** 인증 파일은 Rust에서 읽기 전용으로, 허용된 메타데이터 필드만 읽는다. 토큰 값은 IPC · 로그 · 저장 파일 어디에도 남기지 않는다. 비공개 API를 호출하지 않는다.
- AI는 **공식 CLI를 pane 안에서 실행**하는 방식으로만 다룬다. 한도도 각 CLI가 공식으로 내주는 데이터만 쓰고, 추정치는 UI에 "추정"으로 표시한다.
- 사용자 설정 파일(예: `~/.claude/settings.json`)을 바꿀 때는 **확인 → 백업 → 변경** 순서를 지키고, 되돌리기를 같이 만든다.
- MVP 범위 밖은 넣지 않는다: git worktree 자동화, 에이전트 오케스트레이션, 내장 브라우저, diff 뷰어.
- **가볍게** 만든다. 기동 1초 이내가 목표이고, 의존성을 하나 늘릴 때마다 꼭 필요한지 따져본다.
- AI 정보로 사이드바 공간을 차지하지 않는다. 구독 · 한도는 상태바에만 둔다.

## 명령어

- 개발 실행: `pnpm tauri dev`
- 테스트: `pnpm test` (Vitest), `cargo test --manifest-path src-tauri/Cargo.toml`
- 타입체크 · lint · 포맷: `pnpm typecheck` · `pnpm lint` · `pnpm format:check` (프론트 전체는 `pnpm check`)
- Rust: `cargo fmt --check` · `cargo clippy --all-targets -- -D warnings` (`src-tauri`에서)
- 빌드: `pnpm tauri build`

## 환경

- Windows 11, 기본 셸 PowerShell 7 (`pwsh`). 경로는 Windows 형식이고, 사용자 홈은 `C:\Users\YeonJun`.
- 앱 데이터: `%APPDATA%\LaDock\` (state · settings · limits · backups)
- 이 PC의 AI CLI 위치와 인증 판별 근거는 `docs/milestones/M2-01-provider-detect.md`에 있다.

## 문서 · UI 언어

- 문서와 UI 문자열은 한국어. 코드 식별자 · 주석은 주변 코드에 맞춘다.

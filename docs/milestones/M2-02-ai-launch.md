# M2-02 AI 실행 · 실행 팔레트

- 마일스톤: M2 AI 구독·한도 · 의존: M2-01, M1-03
- 참고: `design-mvp.html`의 `launchAgent`, `renderPalette`, `#palOv`, `agentPane`
- 열린 결정: **AI CLI가 끝나면 pane을 어떻게 할지** — INDEX "열린 결정" 참고

## 목표
감지된 AI CLI를 키 두 번이나 클릭 한 번으로 pane에 띄운다.

## 할 일
- [x] 실행 = `PaneSpec { kind: 'agent', provider, command, args, cwd }`로 새 pane
- [ ] 기본: PTY에서 CLI를 **직접 실행**. 옵션: 셸 안에서 실행해서 CLI가 끝나면 셸 프롬프트로 돌아오기
- [ ] provider별 기본 인자: 모델(`--model`), 이어하기(`claude -c`, `agy -c`), effort(`agy --effort`) 등 — 값은 settings(M3-02)에서
- [x] **구독으로만 실행** (기본 ON): provider별 API 키 환경변수를 `envRemove`로 지우고 실행
  - claude → `ANTHROPIC_API_KEY` · codex → `OPENAI_API_KEY` · gemini/agy → `GEMINI_API_KEY`, `GOOGLE_API_KEY`
- [x] cwd 상속: 포커스된 pane의 현재 폴더 — OSC 7로 추적 (pwsh 프롬프트 함수에 OSC 7 출력 추가하는 방법 검토), 안 되면 그 pane의 시작 cwd
- [x] **실행 팔레트** (`Ctrl+B a`): 숫자 키 = provider, `R` / `D` / `T` = 위치(오른쪽 분할 / 아래 분할 / 현재 세션에 새 탭), Esc 닫기, 미설치는 비활성
- [x] 한도 팝오버의 [▶ 실행] 버튼과 같은 실행 함수 공유 (M2-05)

## 명세
- agent pane 헤더 아이콘 · 색: provider 고유값 (`✻` Claude, `◎` Codex, `✦` Gemini, `▲` Antigravity)
- 미설치 provider를 실행하려 하면 설치 명령 안내 토스트

## 완료 기준
- [x] 이 PC에서 claude · gemini · agy가 팔레트와 버튼으로 실행되고 cwd가 맞음
- [x] 구독으로만 실행 ON일 때 자식 프로세스에 API 키 환경변수가 없음
- [x] AI 종료 후 동작이 "열린 결정"대로 처리됨

## 작업 기록
- 2026-10-19 결정 D1: AI CLI 종료 시 pane은 닫지 않고 마지막 출력을 남긴 채 `Enter로 재시작, x로 닫기` 안내를 띄운다 (M0-03의 종료 후 재시작 동작 재사용).
- 2026-10-19 구현(코드 완료, **GUI 실행 검증 전**): `features/ai/providers.ts`(상태 store · `launchAgent` · provider 메타), 팔레트 오버레이(`Ctrl+B a`, 1–4 실행 · R/D/T 위치), `store.openPane`, agent pane 헤더 글리프, `envRemoveFor`(구독으로만 실행 = 상수 ON, 설정 UI는 M3-02).
- cwd 추적: 셸이 OSC 7을 내보내야 한다. pwsh/powershell은 `shells::resolve`에서 `-NoLogo -NoExit -Command`로 기존 `prompt`를 감싸 OSC 7을 붙인다(실제 pwsh에서 출력 확인). 현재 폴더는 store가 아니라 `registry`의 `cwds` 맵에 둔다 — store `cwd`가 바뀌면 pane이 다시 만들어지기 때문. 다른 셸(cmd · bash · wsl)은 OSC 7이 없어 pane 시작 cwd로 폴백.
- 미설치 안내는 토스트 대신 팔레트 안 문구로 표시(토스트 컴포넌트가 아직 없음).
- 남은 일: 실제 앱에서 claude · gemini · agy 실행 · cwd · API 키 제거 확인, "셸 안에서 실행" 옵션, provider 기본 인자 값(M3-02), 한도 팝오버 버튼(M2-05).
- 2026-10-19 사용자가 실제 앱에서 동작 확인 → 완료 처리. 권한 확인 건너뛰기 플래그를 기본 ON으로 추가(`SKIP_PERMISSIONS`: claude/agy `--dangerously-skip-permissions`, gemini `--yolo`, codex `--dangerously-bypass-approvals-and-sandbox` — codex는 미설치라 미검증). 설정 토글은 M3-02.
- 완료에서 제외(미구현): "셸 안에서 실행" 옵션과 provider 기본 인자 값은 M3-02 설정으로, 한도 팝오버 [▶ 실행] 버튼은 M2-05로 넘긴다.
- 2026-10-19 M2-05 팝오버의 [▶ 실행]이 `launchAgent(id, 'row')`를 그대로 호출함을 확인(가짜 IPC에서 `pty_spawn` 인자: claude 경로, `--dangerously-skip-permissions`, 구독 전용 ON이면 `envRemove: [ANTHROPIC_API_KEY]`). 구독 전용 토글은 팝오버에 있고 저장은 M3-02.

# M2-02 AI 실행 · 실행 팔레트

- 마일스톤: M2 AI 구독·한도 · 의존: M2-01, M1-03
- 참고: `design-mvp.html`의 `launchAgent`, `renderPalette`, `#palOv`, `agentPane`
- 열린 결정: **AI CLI가 끝나면 pane을 어떻게 할지** — INDEX "열린 결정" 참고

## 목표
감지된 AI CLI를 키 두 번이나 클릭 한 번으로 pane에 띄운다.

## 할 일
- [ ] 실행 = `PaneSpec { kind: 'agent', provider, command, args, cwd }`로 새 pane
- [ ] 기본: PTY에서 CLI를 **직접 실행**. 옵션: 셸 안에서 실행해서 CLI가 끝나면 셸 프롬프트로 돌아오기
- [ ] provider별 기본 인자: 모델(`--model`), 이어하기(`claude -c`, `agy -c`), effort(`agy --effort`) 등 — 값은 settings(M3-02)에서
- [ ] **구독으로만 실행** (기본 ON): provider별 API 키 환경변수를 `envRemove`로 지우고 실행
  - claude → `ANTHROPIC_API_KEY` · codex → `OPENAI_API_KEY` · gemini/agy → `GEMINI_API_KEY`, `GOOGLE_API_KEY`
- [ ] cwd 상속: 포커스된 pane의 현재 폴더 — OSC 7로 추적 (pwsh 프롬프트 함수에 OSC 7 출력 추가하는 방법 검토), 안 되면 그 pane의 시작 cwd
- [ ] **실행 팔레트** (`Ctrl+B a`): 숫자 키 = provider, `R` / `D` / `T` = 위치(오른쪽 분할 / 아래 분할 / 현재 세션에 새 탭), Esc 닫기, 미설치는 비활성
- [ ] 한도 팝오버의 [▶ 실행] 버튼과 같은 실행 함수 공유 (M2-05)

## 명세
- agent pane 헤더 아이콘 · 색: provider 고유값 (`✻` Claude, `◎` Codex, `✦` Gemini, `▲` Antigravity)
- 미설치 provider를 실행하려 하면 설치 명령 안내 토스트

## 완료 기준
- [ ] 이 PC에서 claude · gemini · agy가 팔레트와 버튼으로 실행되고 cwd가 맞음
- [ ] 구독으로만 실행 ON일 때 자식 프로세스에 API 키 환경변수가 없음
- [ ] AI 종료 후 동작이 "열린 결정"대로 처리됨

## 작업 기록

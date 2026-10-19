# M1-03 키바인딩 (prefix)

- 마일스톤: M1 세션·탭·pane · 의존: M1-02
- 참고: `design-mvp.html`의 `KEYS`, `setPrefix`, `handlePrefix`, `moveFocus`, `resizeFocused`, `#helpOv`
- 열린 결정: **prefix 키** — INDEX의 "열린 결정" 참고. 정해지기 전에는 `Ctrl+B`로 구현하고 설정으로 바꿀 수 있게 만든다.

## 목표
psmux/tmux처럼 prefix 키로 세션 · 탭 · pane을 전부 키보드로 조작한다.

## 할 일
- [x] prefix 상태 머신: prefix → 2초 대기 → 다음 키 실행 후 해제
- [x] 터미널 입력보다 먼저 가로채기 (xterm 핸들러 대신 window 캡처 — 작업 기록 참고)
- [x] 아래 키표 전체 구현 (`s/w`·`a`는 오버레이 상태만 열고 화면은 M1-04 / M2-02)
- [x] 포커스 이동: 트리 순서가 아니라 **화면상 가장 가까운 pane** (방향별 후보 중 중심 거리 최소)
- [x] 크기 조절: 같은 방향의 가장 가까운 조상 split 비율을 ±0.05
- [ ] 상태바 `PREFIX` 표시 연결 (M1-05)
- [x] 단축키 도움말 오버레이 (`?`), "LaDock 확장" 표시
- [x] prefix 키를 설정값으로 받게 만들기 (설정 UI는 M3-02)
- [ ] prefix 충돌 조사: `Ctrl+B`가 Claude Code · agy · vim · 셸에서 쓰이는지 확인하고 결과를 작업 기록에 남기기

## 키표

| 키 (`Ctrl+B` 다음) | 동작 | 비고 |
| --- | --- | --- |
| `s` / `w` | 세션 · 탭 트리 열기 | tmux choose-tree |
| `C` | 새 세션 | LaDock 확장 |
| `$` | 세션 이름 변경 | |
| `(` / `)` | 이전 / 다음 세션 | |
| `X` | 세션 닫기 | LaDock 확장 |
| `c` | 새 탭 | |
| `,` | 탭 이름 변경 | |
| `n` / `p` | 다음 / 이전 탭 | |
| `0`–`9` | N번 탭 (`0` = 10번) | |
| `&` | 탭 닫기 | |
| `%` | 좌우 분할 (오른쪽에 새 pane) | |
| `"` | 상하 분할 (아래에 새 pane) | |
| `←↑→↓` | pane 포커스 이동 | |
| `Ctrl+←↑→↓` | pane 크기 조절 | |
| `z` | pane 줌 토글 | |
| `x` | pane 닫기 | |
| `a` | AI 실행 팔레트 | LaDock 확장 · M2-02에서 연결 |
| `?` | 단축키 도움말 | |
| `Ctrl+B` | 터미널에 `Ctrl+B`(`\x02`) 그대로 전달 | |

## 명세
- 대소문자 구분: `c` = 새 탭, `C`(Shift) = 새 세션
- prefix 대기 중 Shift · Ctrl · Alt 단독 입력은 무시 (조합 대기)
- 한글 입력 상태에서도 prefix 다음 키가 동작해야 함 → `e.code` 기준 매핑 검토 (M0-04 결과 참고)

## 완료 기준
- [x] 키표의 모든 키가 동작
- [x] 포커스 이동이 복잡한 분할(3단 이상)에서도 화면 기준으로 자연스러움
- [x] 한글 입력 모드에서도 prefix 단축키 동작
- [ ] prefix 충돌 조사 결과 기록

## 작업 기록
- 2026-10-19 결정 D2: prefix는 `Ctrl+B`로 확정, 설정에서 변경 가능. 충돌 조사 결과는 아래에 이어서 적는다.
- 2026-10-19: 키 가로채기는 xterm `attachCustomKeyEventHandler`가 아니라 `window` keydown **캡처 단계**(`features/keys/keys.ts`)로 구현했다. pane마다 핸들러를 달 필요 없고, 포커스가 터미널 밖에 있어도 prefix가 동작하며, `preventDefault`로 keypress까지 막아 xterm에 새 나가지 않는다. 오버레이(도움말·이름 변경)가 열려 있는 동안은 가로채지 않는다.
- 2026-10-19: 문자 키는 `e.code` 기준, 기호(`%` `"` `$` `(` `)` `&` `?`)는 `e.key` 또는 Shift+`e.code`(US 배열)로 맞춘다. 한글 상태의 `e.key`는 단위 테스트로만 확인했고 실제 IME 입력은 미확인.
- 2026-10-19: 포커스 이동은 `tree.neighborPane`(방향 쪽 + 수직축으로 겹치는 후보 중 중심 거리 최소), 크기 조절은 `tree.resizeFocused`(같은 축 가장 가까운 조상 ±0.05). 둘 다 순수 함수로 테스트했다. 줌 상태에서는 포커스 이동을 무시한다.
- 2026-10-19: 상태바(M1-05)가 없어 `PREFIX` 표시는 우하단 임시 배지(`Overlays`)로 뒀다. M1-05에서 상태바로 옮긴다.
- 2026-10-19: **prefix 충돌 조사 — 미완.** 알려진 사실만 적는다(실행 확인 안 함): vim은 `Ctrl+B` = 페이지 위로, PSReadLine/readline emacs 모드는 `Ctrl+B` = 글자 왼쪽 이동, Claude Code는 `Ctrl+B`를 실행 중 명령 백그라운드 전환에 쓴다. prefix를 두 번 누르면 ``가 그대로 전달된다. Codex · Gemini CLI · agy는 확인하지 못했다.
- 2026-10-19: 완료 기준 4개 **미확인** — `pnpm check`(typecheck · lint · format · 단위 테스트 21개)만 통과했고 `pnpm tauri dev`에서 직접 눌러 보지 않았다. 확인할 것: 키표 전체, 3단 이상 분할에서 포커스 이동, 한글 입력 모드, 충돌 조사. M1-02의 미확인 완료 기준도 이 키로 같이 확인할 수 있다.
- 2026-10-19: 사용자가 `pnpm tauri dev`에서 직접 써 보고 동작 확인(키표, 포커스 이동, 한글 모드). M1-02의 3×2×3 · 분할선 드래그 기준도 같이 확인. 남은 것: prefix 충돌 조사(Codex · Gemini CLI · agy 실행 확인)와 M1-02의 pane 20개 기준.
- 2026-10-19: 버그 수정 — `s`/`w`/`a`가 화면 없는 오버레이 상태를 열어 이후 prefix가 먹통이 됐다. 화면이 생기기 전까지 no-op으로 바꿨다. 수정 후 사용자 확인: Claude Code · Antigravity(`agy`) 안에서도 prefix 정상 동작. Codex · Gemini CLI는 미확인.

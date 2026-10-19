# M1-01 세션 · 탭 · pane 상태 모델

- 마일스톤: M1 세션·탭·pane · 의존: M0-03
- 참고: [architecture.md › 데이터 모델](../architecture.md#데이터-모델), `design-mvp.html`의 `replaceNode`, `findPath`, `splitFocused`, `closePane`, `closeWindow`, `closeSession`, `makeWindow`, `winName`

## 목표
세션 → 탭(window) → 분할 트리 → pane 구조를 store와 **순수 함수**로 만들고, 테스트로 동작을 고정한다. UI는 다음 기능들에서 붙인다.

## 할 일
- [x] zustand store: `AppState` (architecture.md 타입 그대로)
- [x] 트리 순수 함수: `split(paneId, dir, newPane)`, `close(paneId)`, `setRatio(splitPath, ratio)`, `leaves(root)`, `findPath(root, paneId)`
- [x] 세션 동작: 새로 만들기 · 이름 변경 · 닫기 · 이동 · 다음/이전
- [x] 탭 동작: 새로 만들기 · 이름 변경 · 닫기 · 이동(N번) · 다음/이전
- [x] pane 생성 → `pty_spawn`, pane 제거 → `pty_kill` 연결 (store 액션에서 한 곳으로)
- [x] Vitest 단위 테스트

## 명세
- **닫기 연쇄**: pane을 닫으면 형제 노드가 부모 자리로 올라감 → 탭의 마지막 pane이면 탭이 닫힘 → 세션의 마지막 탭이면 세션이 닫힘 → 마지막 세션이면 기본 세션(`main`, pwsh 1개)을 새로 만듦
- 닫은 뒤 포커스: 올라온 형제 서브트리의 첫 pane
- 비율: 0.15–0.85로 제한
- 새 pane · 새 탭 · 새 세션은 **포커스된 pane의 cwd와 셸 프로필을 물려받음**
- 새 세션: 색상은 팔레트에서 순서대로 배정, 만들자마자 이름 입력 상태(M1-04)
- **auto-rename**: `Window.name === null`이면 표시 이름 = 포커스된 pane의 프로그램 이름. MVP에서는 `PaneSpec.command`(없으면 셸 이름)를 쓴다. 셸 안에서 직접 실행한 프로그램 감지(포그라운드 프로세스)는 백로그.

## 완료 기준
- [x] 테스트: 분할 → 닫기 승격, 닫기 연쇄(pane → 탭 → 세션 → 기본 세션), 비율 제한, cwd 상속, auto-rename
- [ ] pane이 store에서 사라지면 PTY도 종료됨 (프로세스 누수 없음) — 단위 테스트(registry 모킹)로만 확인. 실제 프로세스 확인은 M1-02에서 TerminalPane을 store에 연결할 때

## 작업 기록

- 2026-10-19: 구조 — `src/store/{types,tree,ops,store}.ts`. `tree.ts`(트리 순수 함수) · `ops.ts`(AppState → AppState 순수 연산) · `store.ts`(zustand, 얇은 래퍼). 테스트는 `store.test.ts`.
- 2026-10-19: 의존성 `zustand` 추가 (architecture.md가 지정한 store).
- 2026-10-19: spawn은 cols/rows가 필요해서 `TerminalPane`에 남기고, kill만 store 한 곳에서 처리한다. store의 모든 변경이 `apply()`를 지나며 `panes`에서 사라진 id를 `registry.killPanePty`로 종료한다. `TerminalPane`은 `paneKey` prop으로 PTY id를 registry에 등록한다 (아직 아무도 `paneKey`를 넘기지 않음 → M1-02).
- 2026-10-19: 초기 pane의 `cwd`는 빈 문자열(= 셸 기본 위치). 호출 쪽에서 `''`를 `undefined`로 바꿔 spawn에 넘긴다.
- 2026-10-19: 포커스되지 않은 pane을 닫으면 포커스는 그대로 둔다 (포커스 이동은 닫힌 pane이 포커스였을 때만).


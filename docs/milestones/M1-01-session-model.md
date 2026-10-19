# M1-01 세션 · 탭 · pane 상태 모델

- 마일스톤: M1 세션·탭·pane · 의존: M0-03
- 참고: [architecture.md › 데이터 모델](../architecture.md#데이터-모델), `design-mvp.html`의 `replaceNode`, `findPath`, `splitFocused`, `closePane`, `closeWindow`, `closeSession`, `makeWindow`, `winName`

## 목표
세션 → 탭(window) → 분할 트리 → pane 구조를 store와 **순수 함수**로 만들고, 테스트로 동작을 고정한다. UI는 다음 기능들에서 붙인다.

## 할 일
- [ ] zustand store: `AppState` (architecture.md 타입 그대로)
- [ ] 트리 순수 함수: `split(paneId, dir, newPane)`, `close(paneId)`, `setRatio(splitPath, ratio)`, `leaves(root)`, `findPath(root, paneId)`
- [ ] 세션 동작: 새로 만들기 · 이름 변경 · 닫기 · 이동 · 다음/이전
- [ ] 탭 동작: 새로 만들기 · 이름 변경 · 닫기 · 이동(N번) · 다음/이전
- [ ] pane 생성 → `pty_spawn`, pane 제거 → `pty_kill` 연결 (store 액션에서 한 곳으로)
- [ ] Vitest 단위 테스트

## 명세
- **닫기 연쇄**: pane을 닫으면 형제 노드가 부모 자리로 올라감 → 탭의 마지막 pane이면 탭이 닫힘 → 세션의 마지막 탭이면 세션이 닫힘 → 마지막 세션이면 기본 세션(`main`, pwsh 1개)을 새로 만듦
- 닫은 뒤 포커스: 올라온 형제 서브트리의 첫 pane
- 비율: 0.15–0.85로 제한
- 새 pane · 새 탭 · 새 세션은 **포커스된 pane의 cwd와 셸 프로필을 물려받음**
- 새 세션: 색상은 팔레트에서 순서대로 배정, 만들자마자 이름 입력 상태(M1-04)
- **auto-rename**: `Window.name === null`이면 표시 이름 = 포커스된 pane의 프로그램 이름. MVP에서는 `PaneSpec.command`(없으면 셸 이름)를 쓴다. 셸 안에서 직접 실행한 프로그램 감지(포그라운드 프로세스)는 백로그.

## 완료 기준
- [ ] 테스트: 분할 → 닫기 승격, 닫기 연쇄(pane → 탭 → 세션 → 기본 세션), 비율 제한, cwd 상속, auto-rename
- [ ] pane이 store에서 사라지면 PTY도 종료됨 (프로세스 누수 없음)

## 작업 기록

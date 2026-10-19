# M1-04 세션 · 탭 UI

- 마일스톤: M1 세션·탭·pane · 의존: M1-01, M1-03
- 참고: `design-mvp.html`의 `renderTitle`, `renderTabs`, `renderSidebar`, `renderChoose`, `chooseItems`, `inlineRename`, `#chooseOv`

## 목표
타이틀바 · 사이드바 · 세션 트리 오버레이로 세션과 탭을 보고 전환한다.

## 할 일
- [x] **타이틀바**: 세션 버튼(색 점 + 이름 + ▾) → 현재 세션의 탭들(번호 · 이름 · 실행 중인 AI 아이콘 · ×) → [+ 새 탭]
- [x] 탭 더블클릭 = 이름 변경, auto-rename 상태인 탭은 이름을 기울임체로
- [x] **사이드바 세션 트리**: 활성 세션만 펼쳐서 탭 목록, 나머지는 접힘 (탭 수 · AI 아이콘), [+ 새 세션]
- [x] **세션 · 탭 트리 오버레이** (`Ctrl+B s` / `w`, 세션 버튼 클릭): 세션과 탭을 한 목록으로, ↑↓ 이동 · Enter 전환 · `C` 새 세션 · `c` 새 탭 · Esc 닫기, 현재 위치 표시
- [x] **이름 변경 입력**: 버튼 안에 `<input>`을 넣지 말고, 버튼을 숨기고 옆에 input을 띄움 (버튼 안 input은 Space가 버튼을 눌러버림). Enter = 저장, Esc = 취소, blur = 저장
- [x] 새 세션을 만들면 바로 세션 이름 입력 상태
- [x] 사이드바 접기/펼치기 (☰)

## 명세
- 세션 버튼은 사이드바가 닫혀 있거나 화면이 좁을 때도 세션을 바꿀 수 있는 길이다 → 항상 표시
- 탭 아이콘: 그 탭 안에서 실행 중인 AI provider 아이콘을 중복 없이 표시

## 완료 기준
- [x] 마우스만으로 세션 · 탭 생성 / 전환 / 이름 변경 / 닫기 가능
- [x] 키보드만으로 트리 오버레이에서 원하는 탭으로 이동 가능
- [x] 이름 입력 중 Space · Enter가 다른 동작을 일으키지 않음

## 작업 기록

- 2026-10-19: 구현 (`src/features/sessions/`: TitleTabs · Sidebar · TreeOverlay · InlineRename · ui.ts). `pnpm check` 통과(typecheck · lint · format · 테스트 21개).
  - 이름 변경은 버튼 대신 같은 자리에 `<input>`을 렌더(버튼 안 input 금지 규칙). Enter 저장 · Esc 취소 · blur 저장, IME 조합 중 Enter 무시.
  - `Ctrl+B C`와 [+ 새 세션]은 `createSessionAndRename`을 거쳐 바로 이름 입력 상태가 된다. `Ctrl+B s/w`는 트리 오버레이를 연다.
  - AI 아이콘은 `pane.kind === 'agent'`의 provider 기준 (실제 agent pane은 M2-02에서 생기므로 아직 표시될 일 없음).
  - **미확인**: 완료 기준 3개는 앱을 띄워 직접 조작해 확인하지 못해 체크하지 않았다. 사이드바 반응형(드로어)은 M1-05 범위.
- 2026-10-19: 사용자가 앱에서 직접 확인해 완료 처리. 추가 수정: 오버레이 키 입력을 캡처 단계에서 받아 xterm으로 새지 않게 함 / 인라인 이름 입력 중 `closeOverlay`가 포커스를 뺏어 입력이 닫히던 문제 수정 / 이름 변경을 우클릭 · 더블클릭 · 사이드바 항목에서도 가능하게 함 (`Renaming.from`으로 입력창이 한 곳에만 뜨게 함).

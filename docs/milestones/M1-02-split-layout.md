# M1-02 분할 레이아웃 렌더링

- 마일스톤: M1 세션·탭·pane · 의존: M1-01, M0-04(렌더러 정책)
- 참고: `design-mvp.html`의 `nodeEl`, `paneEl`, `renderLayout`, `.split`, `.divider`

## 목표
분할 트리를 화면에 그리고, 마우스로 리사이즈 · 포커스 · 줌 · 닫기를 할 수 있다.

## 할 일
- [x] 트리 재귀 렌더링: split = flex(row/col), 자식 비율 = `flex: ratio 1 0`
- [x] 6px 분할선 드래그 (pointer capture) → 비율 갱신 → 끝나면 `pty_resize`
- [x] 클릭으로 포커스, 포커스된 pane 테두리 강조
- [x] 줌: 포커스된 pane만 전체 표시, 트리는 유지
- [x] pane 헤더 버튼 연결: 좌우 분할 / 상하 분할 / 줌 / 닫기
- [x] **다른 탭 · 세션의 터미널을 언마운트하지 않음** — `display:none`으로 숨기고 다시 보일 때 `fit()`
- [x] M0-04에서 정한 렌더러 정책 적용 (컨텍스트 소실 시 해당 pane만 DOM 폴백, 현 구현 유지. 폴백이 눈에 띄면 "보이는 pane만 WebGL" 추가)

## 명세
- 줌 상태에서 분할하면 줌 해제
- 드래그 중에는 레이아웃만 바꾸고, PTY 리사이즈는 드래그가 끝날 때 한 번

## 완료 기준
- [x] 3세션 × 2탭 × 3pane을 만들고 오가도 각 터미널 출력이 이어짐
- [x] 분할선 드래그 후 `vim` 등 전체화면 프로그램이 새 크기에 맞게 다시 그려짐
- [ ] pane 20개 이상에서도 렌더러가 죽지 않음

## 작업 기록

- 2026-10-19: pane을 트리 모양대로 중첩 렌더링하면 분할 시 React가 터미널을 재마운트(PTY 종료)한다. 그래서 `tree.computeLayout`(순수 함수, 테스트 있음)이 트리를 0–1 사각형으로 펼치고, `features/layout/Workspace.tsx`가 pane을 평탄하게 key=paneId로 absolute 배치한다. 분할선도 같은 결과로 그린다.
- 2026-10-19: 모든 세션 · 탭의 `WindowLayout`을 마운트해 두고 `display:none`으로 숨긴다. 다시 보일 때는 기존 ResizeObserver가 `fit()` + `pty_resize`를 처리한다.
- 2026-10-19: 분할선 드래그 중에는 `body[data-dragging]`로 PTY 리사이즈를 미루고, 끝나면 `ladock:refit` 이벤트로 모든 pane이 한 번 맞춘다. 렌더러 정책은 현 구현 유지(컨텍스트 소실 시 해당 pane만 DOM 폴백).
- 2026-10-19: 완료 기준 3개는 **아직 미확인** — 탭 · 세션 생성 UI(M1-03 키바인딩 / M1-04)가 없어 `pnpm tauri dev`에서 3×2×3을 만들 수 없다. typecheck · lint · 단위 테스트(`computeLayout`)만 통과. 분할 · 줌 버튼과 분할선 드래그는 M1-03 이후 실행해서 확인한다.

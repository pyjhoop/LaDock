# M0-03 터미널 pane (xterm.js)

- 마일스톤: M0 스캐폴드 · 의존: M0-02
- 참고: `design-mvp.html`의 `.pane`, `.pane-head`, `headHTML()`

## 목표
`<TerminalPane>` 하나가 PTY와 연결돼서 실제 터미널처럼 동작한다.

## 할 일
- [x] `@xterm/xterm` + addon: `fit`, `webgl`, `unicode11`(한글 폭), `search`, `web-links`
- [x] Channel 출력 → `term.write(data, callback)` — 콜백 기반 흐름 제어
- [x] 입력 `onData` → `pty_write`
- [x] 크기 변화(ResizeObserver) → `fit()` → `pty_resize` (디바운스)
- [x] 복사/붙여넣기: `Ctrl+Shift+C/V`, 우클릭 붙여넣기, 선택 시 자동 복사(설정 옵션, 기본 끔)
- [x] 종료 표시: `[프로세스 종료: code N] — Enter로 재시작, x로 닫기`
- [x] pane 헤더(기본형): 종류 아이콘, 제목, cwd, 활동 점(출력 중 ●), [분할 ▸ / 분할 ▾ / 줌 / 닫기] 버튼 자리
- [x] 터미널 색상을 앱 테마 토큰과 연동

## 명세
- 폰트 기본값: Cascadia Code 13px, 줄 높이 1.2 근처 (xterm 기본과 비교해서 결정)
- 활동 점: 마지막 출력 후 1초 동안 "출력 중"
- pane 헤더가 좁으면 cwd → 활동 글자 → 보조 버튼 순서로 숨김 (container query)

## 완료 기준
- [ ] pwsh에서 `ls`, `vim`(또는 `nvim`), `htop`류 전체화면 프로그램이 정상 표시
- [ ] 창 크기를 바꿔도 줄이 깨지지 않음
- [ ] 복사 · 붙여넣기 · 우클릭 붙여넣기 동작
- [ ] 프로세스 종료 후 Enter로 재시작

## 작업 기록

- 2026-10-19: `src/features/terminal/` 에 `TerminalPane.tsx` · `pty.ts`(IPC 래퍼) · `theme.ts`(CSS 토큰 → xterm 테마, data-theme/시스템 테마 변경 추적) 구현. `App.tsx`는 임시로 pwsh pane 하나를 띄움 (M1-02에서 교체).
- xterm 6.0.0 + addon 5종 추가. WebGL 로드 실패 시 DOM 렌더러로 폴백.
- 종료 후 Enter 재시작은 같은 xterm을 `reset()` 하고 `pty_spawn`을 다시 호출. 헤더 버튼은 닫기만 두고 분할 · 줌은 M1-02에서 연결.
- `pnpm check` · `pnpm build` 통과. **완료 기준 4개는 `pnpm tauri dev`에서 직접 눈으로 확인해야 해서 아직 체크하지 않음** (vim/전체화면 표시, 창 리사이즈, 복붙, 재시작).

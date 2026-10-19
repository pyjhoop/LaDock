# M0-03 터미널 pane (xterm.js)

- 마일스톤: M0 스캐폴드 · 의존: M0-02
- 참고: `design-mvp.html`의 `.pane`, `.pane-head`, `headHTML()`

## 목표
`<TerminalPane>` 하나가 PTY와 연결돼서 실제 터미널처럼 동작한다.

## 할 일
- [ ] `@xterm/xterm` + addon: `fit`, `webgl`, `unicode11`(한글 폭), `search`, `web-links`
- [ ] Channel 출력 → `term.write(data, callback)` — 콜백 기반 흐름 제어
- [ ] 입력 `onData` → `pty_write`
- [ ] 크기 변화(ResizeObserver) → `fit()` → `pty_resize` (디바운스)
- [ ] 복사/붙여넣기: `Ctrl+Shift+C/V`, 우클릭 붙여넣기, 선택 시 자동 복사(설정 옵션, 기본 끔)
- [ ] 종료 표시: `[프로세스 종료: code N] — Enter로 재시작, x로 닫기`
- [ ] pane 헤더(기본형): 종류 아이콘, 제목, cwd, 활동 점(출력 중 ●), [분할 ▸ / 분할 ▾ / 줌 / 닫기] 버튼 자리
- [ ] 터미널 색상을 앱 테마 토큰과 연동

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

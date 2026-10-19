# M0-01 프로젝트 셋업

- 마일스톤: M0 스캐폴드 · 의존: 없음
- 참고: [architecture.md › 폴더 구조](../architecture.md#폴더-구조-예정--m0-01에서-확정-후-갱신), `design-mvp.html`의 `.titlebar`, `:root` 토큰

## 목표
빈 Tauri v2 + React + TypeScript 앱이 **커스텀 타이틀바 창**으로 뜨고, lint · test 명령이 돌아가는 상태.

## 할 일
- [ ] `git init` + `.gitignore` (현재 git 저장소가 아님)
- [ ] `pnpm create tauri-app` — React + TS + Vite, 루트에 `src/`, `src-tauri/`
- [ ] 폴더 구조를 architecture.md 기준으로 만들고, 달라진 점은 architecture.md에 반영
- [ ] TS `strict`, ESLint + Prettier / Rust `rustfmt` + `clippy`
- [ ] 테스트 러너: Vitest(프론트), `cargo test`(Rust) — 샘플 테스트 1개씩
- [ ] 창 설정: `decorations: false`, 최소 크기, 커스텀 타이틀바(드래그 영역 `data-tauri-drag-region`, 최소화/최대화/닫기)
- [ ] 테마 토큰: `design-mvp.html`의 `:root` 색 토큰을 CSS 변수로 옮기기 (다크 기본 / 라이트 / 시스템)
- [ ] 의존성 버전 고정 (Tauri, xterm 등 — 업데이트로 깨지는 일 방지)
- [ ] **CLAUDE.md의 "명령어" 절을 실제 명령으로 채우기**

## 명세
- 패키지 매니저: pnpm
- 앱 식별자 예: `com.laoh.ladock` (이름이 바뀌면 같이 수정)
- 폰트: UI는 시스템 폰트 스택, 터미널은 `Cascadia Code` → `Cascadia Mono` → `D2Coding` → `Consolas`

## 완료 기준
- [ ] `pnpm tauri dev`로 창이 뜨고, 타이틀바 드래그 · 최소화 · 최대화 · 닫기가 동작
- [ ] lint · 타입체크 · 테스트 명령이 모두 통과
- [ ] 다크/라이트 전환 시 배경 · 글자색 토큰이 바뀜
- [ ] CLAUDE.md 명령어 절이 채워짐

## 작업 기록
<!-- 진행하면서 결정 · 발견한 사실을 날짜와 함께 적는다 -->

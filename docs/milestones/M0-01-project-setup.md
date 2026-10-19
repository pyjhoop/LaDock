# M0-01 프로젝트 셋업

- 마일스톤: M0 스캐폴드 · 의존: 없음
- 참고: [architecture.md › 폴더 구조](../architecture.md#폴더-구조-예정--m0-01에서-확정-후-갱신), `design-mvp.html`의 `.titlebar`, `:root` 토큰

## 목표
빈 Tauri v2 + React + TypeScript 앱이 **커스텀 타이틀바 창**으로 뜨고, lint · test 명령이 돌아가는 상태.

## 할 일
- [x] `git init` + `.gitignore` (현재 git 저장소가 아님)
- [x] `pnpm create tauri-app` — React + TS + Vite, 루트에 `src/`, `src-tauri/`
- [x] 폴더 구조를 architecture.md 기준으로 만들고, 달라진 점은 architecture.md에 반영
- [x] TS `strict`, ESLint + Prettier / Rust `rustfmt` + `clippy`
- [x] 테스트 러너: Vitest(프론트), `cargo test`(Rust) — 샘플 테스트 1개씩
- [x] 창 설정: `decorations: false`, 최소 크기, 커스텀 타이틀바(드래그 영역 `data-tauri-drag-region`, 최소화/최대화/닫기)
- [x] 테마 토큰: `design-mvp.html`의 `:root` 색 토큰을 CSS 변수로 옮기기 (다크 기본 / 라이트 / 시스템)
- [x] 의존성 버전 고정 (Tauri, xterm 등 — 업데이트로 깨지는 일 방지)
- [x] **CLAUDE.md의 "명령어" 절을 실제 명령으로 채우기**

## 명세
- 패키지 매니저: pnpm
- 앱 식별자 예: `com.laoh.ladock` (이름이 바뀌면 같이 수정)
- 폰트: UI는 시스템 폰트 스택, 터미널은 `Cascadia Code` → `Cascadia Mono` → `D2Coding` → `Consolas`

## 완료 기준
- [x] `pnpm tauri dev`로 창이 뜨고, 타이틀바 드래그 · 최소화 · 최대화 · 닫기가 동작
- [x] lint · 타입체크 · 테스트 명령이 모두 통과
- [x] 다크/라이트 전환 시 배경 · 글자색 토큰이 바뀜
- [x] CLAUDE.md 명령어 절이 채워짐

## 작업 기록
<!-- 진행하면서 결정 · 발견한 사실을 날짜와 함께 적는다 -->
- 2026-10-19 문서를 먼저 커밋·푸시(origin/main)한 뒤 시작. 기본 브랜치 `main`.
- 2026-10-19 `pnpm create tauri-app`(react-ts)을 임시 폴더에 만든 뒤 루트로 옮김. 템플릿의 `tauri-plugin-opener`, `greet` 예제, 로고 에셋은 제거(의존성 최소화).
- 2026-10-19 버전 고정: `.npmrc`에 `save-exact=true`, package.json은 설치된 정확한 버전으로 고정(react 19.3.1, tauri api 2.12.4, vite 8.3.4 등). Rust는 Cargo.toml 범위(`"2"`)를 두고 **Cargo.lock으로 고정**(커밋 대상).
- 2026-10-19 Vitest 설정은 `vite.config.ts`에 통합. 환경은 node, `src/**/*.test.ts`만 대상. 컴포넌트 테스트가 필요해지면 jsdom 추가.
- 2026-10-19 테마: `theme.css`는 시안 :root 토큰 그대로(기본 다크 = `data-theme="dark"`, `system`이면 속성 제거 후 `prefers-color-scheme`). 선택은 임시로 localStorage(`ladock.theme`)에 저장 — M3-02에서 settings.json으로 이전. 타이틀바에 임시 "테마 전환" 버튼(다크→라이트→시스템) 추가, M1-04에서 정리.
- 2026-10-19 Prettier가 CLAUDE.md를 건드려서 `*.md`와 docs를 `.prettierignore`에 추가.
- 2026-10-19 확인함: `pnpm check`(tsc·eslint·prettier·vitest) 통과, `cargo fmt/clippy -D warnings/test` 통과, `pnpm tauri dev`로 창 기동 및 다크 테마·타이틀바 렌더링 확인.
- 2026-10-19 재확인(Win32 입력 자동화): 최대화 → 복원, 빈 영역 드래그(100,100 → 250,180 이동), 최소화, 닫기(프로세스 종료) 모두 동작. 테마 버튼 3회 클릭 시 배경 #0d1015(다크) → #eef0f3(라이트) → 라이트(시스템, OS 라이트) → #0d1015로 순환.

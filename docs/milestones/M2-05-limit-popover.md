# M2-05 상태바 한도 표시 · 팝오버

- 마일스톤: M2 AI 구독·한도 · 의존: M1-05, M2-01, M2-03, M2-04
- 참고: `design-mvp.html`의 `renderStatus`(pill), `renderUsage`, `limitHTML`, `showUsage`, `setUsagePinned`, `.usage-pop`, `.lim`, `.meter`
- 사용자 요구: AI 구독 정보가 사이드바를 차지하면 안 됨 → **상태바에만** 두고, 보고 싶을 때 마우스를 올려서 본다. 보여줄 것은 **사용량이 아니라 한도**.

## 목표
상태바에서 한도를 한눈에 보고, 마우스를 올리면 자세히 본다.

## 할 일
- [x] **상태바 표시**: provider마다 아이콘 + 창별 짧은 이름과 % + 상태 점 — 예: `✻ 5H 24% 7D 41% ● ✦ 1D 1% ●`
  - 점 색 = 그 provider에서 가장 많이 쓴 창의 상태
  - 좁은 화면(< 640px): 창 이름을 빼고 아이콘 + %만
- [x] **팝오버 열고 닫기**: 마우스 올리면 열림, 벗어나면 180ms 뒤 닫힘(팝오버 위로 옮기면 유지), 클릭하면 고정, 바깥 클릭 · Esc로 닫기, 터치 화면은 클릭만
- [x] **팝오버 내용** (provider별 섹션)
  - 머리: 아이콘 · 이름 · 플랜 배지(🟢 구독 / 🟡 확인 필요 · API 키 경고 / ⚪ 로그아웃) · [▶ 실행] (M2-02 실행 함수)
  - 창마다 게이지: 이름(5시간 / 주간 / 일일 요청) · 상태 글자 · % · 막대 · "남은 N%" 또는 "12 / 1,000회" · "N시간 M분 후 리셋" 또는 "리셋 시각 미확인"
  - 출처 태그 `공식` / `추정` + 출처 설명 + 마지막 갱신 시각
  - 한도 정보가 없으면 "한도 정보 없음"
  - 미설치 provider는 한 줄: `Codex · 미설치 [설치 명령 복사]`
  - 아래: "구독으로만 실행" 토글 + 안내 문구
  - [다시 확인] = `limits_get { force: true }` + `providers_detect`
- [x] 리셋까지 남은 시간은 30초마다 갱신
- [x] Claude 브리지가 연결되지 않았으면 Claude 섹션에 [연결하기] (M2-03 연결 흐름)

## 명세
- 상태 기준: 여유 < 70% ≤ 주의 < 90% ≤ 임박 — **색과 글자를 같이** 표시 (색만으로 구분하지 않음)
- 상태 색은 상태 전용 토큰(`--ok`, `--warn`, `--danger`)만 사용, provider 색과 섞지 않음
- 숫자는 고정폭 폰트, 접근성: 막대에 `role="meter"` + `aria-valuenow` + `aria-label`

## 완료 기준
- [x] 상태바 표시와 팝오버 값이 `limits_get` 결과와 일치
- [x] 마우스 · 키보드(Esc) · 터치에서 열고 닫기가 자연스러움
- [x] 1024px · 860px · 390px 폭에서 팝오버가 화면 밖으로 나가지 않음

## 작업 기록

- 2026-10-19 구현 (`src/features/limits/`: `limits.ts` 스토어 · 순수 함수, `LimitBar.tsx`, `limits.css`). `pnpm check`(typecheck · lint · format · Vitest 29개) 통과.
  - 설치된 provider만 상태바에 표시. 창이 없는 provider는 `–`. 점 색 = 가장 많이 쓴 창의 상태(`aria-label`에 글자), 팝오버 게이지에는 색 + 글자(여유/주의/임박) 같이.
  - 팝오버는 `position: fixed`(상태바 위, 오른쪽 정렬, 폭 `min(380px, 100vw-16px)`, 높이 제한 + 스크롤) → 좁은 화면에서도 밖으로 안 나가게 설계. 마우스(`pointerType==='mouse'`)만 hover 열림, 터치는 클릭만.
  - Esc는 capture 단계에서 가로채 prefix 키 처리와 겹치지 않게 함.
  - "구독으로만 실행" 토글을 위해 `SUBSCRIPTION_ONLY` 상수를 `useLaunchPrefs` 스토어로 바꿈. **저장은 안 함**(앱 재시작 시 ON) — 영속화는 M3-02.
  - Claude 브리지 [연결하기]는 팝오버 안 2단계 확인(설명 → [확인하고 연결]) 후 `claude_bridge_connect { confirm: true }`. [연결 해제] UI는 이 기능 범위 밖이라 만들지 않음(Rust 명령은 있음) — 필요하면 M3-02 설정에.
  - 리셋 시각 갱신은 팝오버가 열려 있는 동안만 30초 타이머.
  - **미확인**: 실제 앱(`pnpm tauri dev`)에서 열고 닫기 · 1024/860/390px 레이아웃 · `limits_get` 값 대조는 아직 눈으로 확인하지 못해 완료 기준 체크를 비워 둠.
- 2026-10-19 첫 구현이 `design-mvp.html`을 읽지 않고 만들어져 시안과 달랐음 → `renderStatus` · `renderUsage` · `limitHTML` 구조와 `.usage-pill` · `.usage-pop` · `.lim` · `.meter` · `.badge` · `.pglyph` · `.switch-row` CSS를 시안 그대로 옮겨 다시 작성. 시안에 없는 것은 Claude 브리지 [연결하기](확인 단계 포함)와 인증 경고 문구뿐.
  - 시안대로: 헤더(제목 · 부제 · 새로고침 아이콘), provider 아이콘 박스 + 구독 배지 + [실행](오른쪽 분할 `row`, 실행하면 팝오버 닫힘), 창별 상태 점 + 글자, 하단 안내 문구, fade/슬라이드 전환. pill은 한도 창이 있는 provider만 표시.
- 2026-10-19 Gemini 제거에 맞춰 팝오버 안내 문구에서 Gemini 문장 삭제. Antigravity는 모델 묶음별 소제목 아래 게이지를 나눠 표시(`lim-group`). 팝오버를 열 때 `limits_get`을 한 번 호출해 낡은 agy 값을 갱신.
- 2026-10-19 **검증** (`pnpm check` + 헤드리스 Edge를 CDP로 조작, 51개 항목 통과). 가짜 IPC에 실제 `limits_get` · `providers_detect` 출력(이 PC의 Claude 16%/6%, agy 4개 창)을 넣고 `vite`로 띄운 화면을 조작:
  - 값 일치: pill · 팝오버 %, 구독 배지(Pro 구독), 공식 태그, 리셋 문구, Codex 미설치 줄이 `limits_get`과 같음.
  - 마우스: hover 열림, 벗어나면 180ms 뒤 닫힘(100ms에는 유지), 팝오버 위로 옮기면 유지, 클릭 고정, 바깥 클릭 · Esc 닫기. 터치(에뮬레이션): 탭으로 열고 바깥 탭으로 닫힘.
  - 폭: 1024 · 860 · 390px에서 팝오버가 화면 안, 가로 스크롤 없음, 두 칸 게이지 리셋 문구 안 잘림. 390px은 창 이름(5H/7D) 숨김.
  - 이벤트: `limits://changed` → pill · 막대 색(주의/임박) · 글자 갱신, `providers://changed` → 배지 갱신.
  - [다시 확인]=`limits_get{force:true}`+`providers_detect`, [▶ 실행]=`launchAgent`(claude, `--dangerously-skip-permissions`, 구독 전용 ON이면 `ANTHROPIC_API_KEY` 제거 / OFF면 제거 안 함, 팝오버 닫힘), [연결하기]는 확인 문구 → `claude_bridge_connect{confirm:true}`.
  - **한계**: 실제 Tauri 창이 아니라 Edge 헤드리스 + 가짜 IPC다. 실제 앱 창(WebView2)에서의 CDP 연결은 이 환경에서 안 돼서(포트가 안 열림) 못 했다. 터치도 실제 기기가 아니라 에뮬레이션. 개발 모드(StrictMode)에서 `pty_spawn`이 클릭 한 번에 2번 불리는 건 기존 동작으로 보임(둘 다 같은 claude pane).

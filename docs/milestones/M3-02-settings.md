# M3-02 설정

- 마일스톤: M3 복원·설정 · 의존: M1-03, M1-06, M2-02, M2-04
- 참고: [architecture.md › 저장 위치](../architecture.md#저장-위치)

## 목표
매일 쓰면서 바꾸고 싶은 최소한의 값을 설정 화면에서 바꾼다.

## 할 일
- [x] `settings_load` / `settings_save` — `%APPDATA%\LaDock\settings.json`, 바뀌면 즉시 적용
- [x] 설정 화면 (간단한 오버레이 또는 패널, 단축키는 정해서 키표에 추가)
- [x] 항목:
  - 기본 셸 (M1-06 감지 목록에서 선택, 기본 pwsh)
  - 터미널 폰트 · 크기 (기본 Cascadia Code 13)
  - 테마: 다크(기본) / 라이트 / 시스템
  - prefix 키 (기본 `Ctrl+B`, 충돌 경고)
  - 선택 시 자동 복사 (기본 끔)
  - provider별 기본 인자 (모델, 이어하기, effort)
  - 구독으로만 실행 (기본 켬)
  - Claude 한도 브리지 연결 상태 · [연결] / [연결 해제] (M2-03)
  - 브리지 대신 기존 `statusline.js`에 한 줄을 추가해서 `limits/claude.json`을 쓰게 하는 방법 안내 (M2-03에서 이동)
- [x] 알 수 없는 키는 무시, 없는 키는 기본값 (앞으로 항목이 늘어도 안 깨지게)

## 완료 기준
- [x] 모든 항목이 저장되고 재시작 후에도 유지
- [x] 폰트 · 테마 · prefix 변경이 재시작 없이 바로 반영

## 작업 기록
- 2026-10-19: 구현. 설정 화면은 `prefix .` 또는 타이틀바 ⚙ 버튼으로 연다 (키표에 "LaDock 확장"으로 추가).
  - 저장: Rust는 `state.json`과 같은 원문 입출력(`settings_load`/`settings_save`, 임시 파일 후 교체), 검증은 프론트 `parseSettings` — 알 수 없는 키 무시 · 없거나 잘못된 값은 항목별 기본값. 변경 400ms 디바운스 저장.
  - 적용: 테마 · 기본 셸 · prefix는 `settings/apply.ts` 구독, 폰트 · 자동 복사는 `TerminalPane` props → 폰트 바뀌면 refit.
  - `SKIP_PERMISSIONS` 상수와 `useLaunchPrefs`를 설정으로 대체. "권한 확인 생략"도 설정에 토글로 넣음 (기본 켬, 사용자 요청 기본 동작 유지).
  - provider별 기본 인자는 모델/이어하기/effort 전용 필드 대신 provider마다 자유 입력 한 줄(공백 구분, `"…"` 묶기)로 단순화 — 기본안.
  - prefix는 Ctrl 또는 Alt 필수, 글자 · 숫자 · F키만. Ctrl+A/C/D/E/K/L/R/U/W/Z는 셸 단축키라 경고.
  - 기본 셸이 바뀌면 이미 열린 pane은 그대로, 새 세션 · 분할부터 적용. 저장된 레이아웃이 없는 첫 실행은 기본 셸로 첫 세션을 만든다.
  - 한도 브리지: 연결(확인 단계 포함) · 해제, 기존 `statusline.js`에 붙일 한 줄 안내(복사 버튼). 해제는 `claude_bridge_disconnect` 사용.
- 검증: typecheck · lint · format · vitest 44개 · cargo clippy/test 통과. **앱을 띄운 GUI 확인(재시작 후 유지, 즉시 반영, 브리지 연결/해제 왕복)은 아직 안 함** → 완료 기준 미체크.
- 2026-10-19: 사용자가 앱에서 직접 확인하고 완료로 승인. 후속으로 pane·타이틀바를 design-mvp 시안에 맞추고, 설정 버튼은 테마 버튼과 겹쳐 보여 상태바 오른쪽(`?` 옆)으로 옮김.

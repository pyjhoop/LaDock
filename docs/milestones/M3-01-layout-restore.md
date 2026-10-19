# M3-01 레이아웃 저장 · 복원

- 마일스톤: M3 복원·설정 · 의존: M1-01, M2-02
- 참고: [architecture.md › 데이터 모델](../architecture.md#데이터-모델) (`AppState`), [› 저장 위치](../architecture.md#저장-위치)

## 목표
앱을 껐다 켜도 세션 · 탭 · 분할 구조 · 작업 폴더가 그대로 돌아온다.

## 할 일
- [x] `state_save`: `%APPDATA%\LaDock\state.json`에 저장 — 변경 후 1초 디바운스, 앱 종료 직전 한 번 더
- [x] 저장 내용: 세션 → 탭 → 분할 트리 · 비율 · 활성 세션/탭 · 포커스 · pane별 `{ profileId, cwd, command, args, kind, provider }`
- [x] `state_load`: 시작할 때 같은 구조로 **새 프로세스를 띄워 복원** (프로세스 자체는 복원 안 됨)
- [x] AI pane 복원: "이전 대화 이어서 열기" 선택지 → `claude -c` / `agy -c`, 아니면 새로 시작
- [x] 저장 파일이 깨졌거나 버전이 다르면: 백업해 두고 기본 세션으로 시작 + 알림
- [x] 파일에 `version` 필드를 두고 마이그레이션 자리 만들기
- [x] 복원할 cwd가 사라졌으면 홈 폴더로

## 완료 기준
- [x] 3세션 × 여러 탭 × 분할을 만든 뒤 재시작하면 같은 구조 · cwd로 열림
- [x] AI pane 이어하기가 동작
- [x] state.json을 일부러 망가뜨려도 앱이 정상 시작

## 작업 기록
- 2026-10-19: 구현 — Rust `persist.rs`(원문 읽기 · 원자적 쓰기 · 깨진 파일 격리 · 폴더 존재 확인), 프론트 `features/persist`(검증 · 마이그레이션 자리 `parseStateFile` · 복원 게이트 `RestoreGate`).
- 파일 모양은 `{ version: 1, state: AppState }`. 구조 검증(레이아웃이 가리키는 pane 존재, 고아 pane 없음 등)을 통과 못 하면 `state.corrupt-<초>.json`으로 옮기고 기본 세션 + 알림 배너.
- 저장 시점: store 변경 1초 디바운스 + 15초마다 변경 확인(OSC 7 cwd는 store 밖에서 바뀜) + 창 닫기 직전(`onCloseRequested` → 저장 → `destroy`, capability `allow-destroy` 추가). 저장 cwd는 살아 있는 OSC 7 값을 우선.
- 이어하기: AI pane이 있으면 시작 때 "이어서 열기(Enter) / 새로 시작(N)"을 한 번 묻는다. Claude Code · Antigravity는 `-c`, Codex는 이어하기 인자를 정하지 않아 항상 새로 시작(기능 파일 명세대로).
- 사라진 cwd는 `''`(셸 기본 위치)로 바꾼다.
- 자동 검증: vitest(왕복 · 거부 · 이어하기 · cwd) + cargo test(파일 입출력). 완료 기준 3개는 사용자가 `pnpm tauri dev`로 직접 확인했다 (2026-10-19).

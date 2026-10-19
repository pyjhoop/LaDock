# M2-04 Gemini 일일 추정 · 다른 provider 한도

- 마일스톤: M2 AI 구독·한도 · 의존: M2-01
- 참고: [architecture.md › 데이터 모델](../architecture.md#데이터-모델) (`LimitStatus`)
- 공식 문서: <https://geminicli.com/docs/resources/quota-and-pricing/>

## 목표
Claude 말고 다른 provider의 한도를 **얻을 수 있는 만큼** 보여주고, 확실하지 않은 값은 "추정"이라고 밝힌다.

## Gemini CLI — 일일 요청 추정
- 공식 한도표 (Google 계정 로그인 기준): 개인 무료 1,000 · Google AI Pro 1,500 · AI Ultra 2,000회/일 (API 키 무료 등급은 250회, Flash만)
- 오늘 요청 수: `~\.gemini\tmp\<project>\chats\session-*.json`의 `messages[]` 중 오늘(로컬 날짜) `timestamp`이면서 `tokens`가 있는 모델 응답 수 (2026-10-19, 이 PC에서 필드 확인)
- 사용률 = 오늘 요청 수 ÷ 플랜 한도 → `LimitStatus { source: 'estimate', windows: [{ key: '1d', used, limit }] }`
- 플랜은 알 수 없음 → 설정에서 선택 (기본: 개인 무료 1,000)
- 리셋 시각은 공식 문서에 없음 → `resetsAt` 비움 ("리셋 시각 미확인")
- 공식 문서상 Gemini CLI는 2026-06-18부로 Antigravity CLI로 대체됨 → 공들이지 말고 최소 구현

## 할 일
- [x] Gemini 추정 구현 (파일이 많을 수 있으니 오늘 날짜 이후 수정된 파일만 읽기)
- [x] 플랜 설정값 연결 (설정 UI는 M3-02)
- [x] Antigravity: `LimitStatus { source: 'none', windows: [] }` + `sourceDetail` "한도 정보를 얻을 공식 경로를 아직 찾지 못했어요"
- [x] Antigravity 조사 (시간 제한 두고): agy 안의 슬래시 명령, `agy --help`, 공식 문서 → 찾으면 구현, 못 찾으면 결과만 기록
  - 알고 있는 것: `~\.gemini\antigravity-cli\cli.log`에 `quota_manager.go: doRefreshQuota`가 찍히지만 값은 남지 않음. `history.jsonl`은 `display, timestamp, workspace`만 있음
- [x] Codex: 미설치면 건너뜀. 설치되면 `~\.codex\sessions\YYYY\MM\DD\*.jsonl`의 `token_count` 이벤트에 있는 `rate_limits`(5시간 · 주간, 커뮤니티 도구들의 설명) 확인 후 구현
- [x] `limits_get`이 모든 provider 결과를 합쳐서 반환

## 완료 기준
- [ ] Gemini 일일 추정치가 표시되고 "추정" 태그가 붙음 — 백엔드는 `source: estimate`, `sourceDetail`이 "추정"으로 시작. 화면 표시는 M2-05에서 확인
- [x] agy · Codex는 상태(정보 없음 / 미설치)가 정확히 표시됨 — `limits_get` 결과 구조만 확인, 화면 표시는 M2-05
- [x] agy 조사 결과가 작업 기록에 남음

## 작업 기록
- 2026-10-19 구현: `src-tauri/src/limits/gemini.rs`, `limits/mod.rs`(`antigravity()`, `codex()`, `get()`가 4개 합쳐 반환). `LimitWindow`에 `used`/`limit` 추가.
- 결정: 로컬 날짜 경계는 chrono 없이 Win32 `GetTimeZoneInformation`을 직접 선언해서 계산 (의존성 추가 회피). 플랜은 `%APPDATA%\LaDock\settings.json`의 `geminiPlan`(`free`｜`pro`｜`ultra`｜`apikey`)을 읽고 없으면 개인 무료 1,000 — 설정 UI는 M3-02.
- 확인: 실제 `~/.gemini/tmp`로 실행하면 오늘 0회 ÷ 1000회 (오늘 Gemini CLI를 안 써서 0이 맞음). 과거 날짜 계산은 단위 테스트로만 확인.
- agy 조사: `agy --help`에 한도·quota 관련 옵션·서브커맨드 없음 (`models`, `changelog` 등뿐), `agy models`는 모델 목록만 출력. `cli.log`의 `quota_manager.go`는 갱신 시도만 남기고 값은 없음 → 공식 경로 못 찾음, `source: none`으로 표시. 대화형 슬래시 명령은 확인하지 않음.
- Codex: 이 PC 미설치(D3)라 `rate_limits` 형식을 확인할 수 없어 읽기는 구현하지 않음. 세션 폴더가 있으면 "읽기 미구현", 없으면 "Codex 미설치".

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
- [ ] Gemini 추정 구현 (파일이 많을 수 있으니 오늘 날짜 이후 수정된 파일만 읽기)
- [ ] 플랜 설정값 연결 (설정 UI는 M3-02)
- [ ] Antigravity: `LimitStatus { source: 'none', windows: [] }` + `sourceDetail` "한도 정보를 얻을 공식 경로를 아직 찾지 못했어요"
- [ ] Antigravity 조사 (시간 제한 두고): agy 안의 슬래시 명령, `agy --help`, 공식 문서 → 찾으면 구현, 못 찾으면 결과만 기록
  - 알고 있는 것: `~\.gemini\antigravity-cli\cli.log`에 `quota_manager.go: doRefreshQuota`가 찍히지만 값은 남지 않음. `history.jsonl`은 `display, timestamp, workspace`만 있음
- [ ] Codex: 미설치면 건너뜀. 설치되면 `~\.codex\sessions\YYYY\MM\DD\*.jsonl`의 `token_count` 이벤트에 있는 `rate_limits`(5시간 · 주간, 커뮤니티 도구들의 설명) 확인 후 구현
- [ ] `limits_get`이 모든 provider 결과를 합쳐서 반환

## 완료 기준
- [ ] Gemini 일일 추정치가 표시되고 "추정" 태그가 붙음
- [ ] agy · Codex는 상태(정보 없음 / 미설치)가 정확히 표시됨
- [ ] agy 조사 결과가 작업 기록에 남음

## 작업 기록

# M2-03 Claude 한도 — statusline 브리지

- 마일스톤: M2 AI 구독·한도 · 의존: M0-01
- 참고: [architecture.md › 데이터 모델](../architecture.md#데이터-모델) (`LimitStatus`), [› 저장 위치](../architecture.md#저장-위치), [› 보안 경계](../architecture.md#보안-경계)
- 공식 문서: <https://code.claude.com/docs/en/statusline> (Rate limit 필드)

## 목표
Claude 구독의 **5시간 · 주간 한도 사용률과 리셋 시각**을 공식 statusline 데이터에서 받아온다. 사용자의 기존 statusline 표시는 그대로 둔다.

## 배경 (2026-10-19 확인)
- Claude Code는 statusline 명령의 stdin으로 JSON을 넘기고, 여기에 `rate_limits`가 들어 있다:
  - `rate_limits.five_hour.used_percentage` / `.resets_at`(unix 초)
  - `rate_limits.seven_day.used_percentage` / `.resets_at`
  - Pro / Max 구독자에게만, 세션의 **첫 API 응답 이후**부터 제공. 각 창은 따로 빠질 수 있고, `resets_at`이 지나면 Claude Code가 그 창을 뺀다.
- 이 PC의 현재 설정 (`~/.claude/settings.json`):
  ```json
  "statusLine": { "type": "command", "command": "node \"C:/Users/YeonJun/.claude/statusline.js\"", "refreshInterval": 30 }
  ```
  `statusline.js`가 이미 같은 `rate_limits`로 `5H` / `7D`를 표시 중 → **완료 판단 기준으로 쓴다.**

## 할 일
- [x] `ladock.exe statusline-bridge` 서브커맨드 (창 없이 실행) — 원래 명령은 인자가 아니라 `bridge.json`에서 읽음 (작업 기록 참고)
  - stdin JSON을 끝까지 읽음 → `rate_limits`, `session_id`만 뽑아서 `%APPDATA%\LaDock\limits\claude.json`에 저장 (임시 파일 → rename, `updatedAt` 포함)
  - 같은 stdin을 원래 명령에 넘기고, stdout · stderr · 종료 코드를 그대로 전달
  - **브리지 쪽 실패(파싱 · 저장 실패)가 원래 출력을 절대 막지 않음**
  - 빠르게 끝나야 함 (statusline은 자주 실행됨) — 실행 시간 측정 (작업 기록)
- [x] 원래 statusline이 없던 경우: 브리지만 실행하고 출력은 비움 (코드 경로만, 직접 실행은 안 함)
- [x] `claude_bridge_status` / `_connect` / `_disconnect` — 코드 · 순수 함수 테스트는 끝, 실제 `~/.claude/settings.json`에 연결해 본 적 없음
  - 연결: 사용자 확인 → `~/.claude/settings.json`을 `%APPDATA%\LaDock\backups\`에 백업 → `statusLine.command`만 브리지로 감쌈 (`refreshInterval` 등 나머지는 유지)
  - 해제: 원래 명령으로 복구
  - 앱 시작 때 점검: 연결이 풀렸거나(Claude Code가 설정을 바꿈) 실행 파일 경로가 바뀌었으면(개발/설치 경로 차이) 알려주고 다시 연결 제안
- [x] `limits/claude.json` 파일 감시 → `limits://changed` — 코드만 작성, 앱에서 이벤트 확인 안 함
- [x] `limits_get`에서 Claude 부분: 파일을 읽어 `LimitStatus { source: 'official' }`로 변환
- [x] 대안 안내(설정 화면): 브리지 대신 기존 `statusline.js`에 한 줄을 추가해서 같은 파일을 쓰게 하는 방법 — M3-02 설정 화면 작업으로 옮김

## 명세
- 여러 Claude Code 세션이 동시에 돌면 **가장 최근에 쓴 값**을 사용
- 오래된 값: `resets_at`이 지난 창은 "리셋됨 · 다음 응답 때 갱신"으로 표시, 마지막 갱신 시각은 항상 표시
- 브리지는 `rate_limits` 외의 필드(대화 내용 등)를 저장하지 않음

## 완료 기준
- [x] 연결 후 Claude Code를 쓰면 LaDock에 표시되는 5시간 · 주간 %가 `statusline.js` 표시와 같음
- [ ] 연결 전후로 Claude Code의 statusline 출력이 바이트 단위로 같음 — 브리지 CLI 직접 실행으로는 같음(`cmp`), Claude Code 경유는 미확인
- [x] 연결 해제하면 `settings.json`의 `statusLine`이 원래 값과 같아짐
- [x] 브리지 실행 시간이 statusline 체감에 영향 없을 만큼 짧음 (측정값 기록)

## 작업 기록
- 2026-10-19 구현: `src-tauri/src/{bridge.rs, limits/{mod,claude,watch}.rs}`. `serde_json`에 `preserve_order` 추가 — settings.json을 고쳐 쓸 때 키 순서가 바뀌지 않게 (해제 시 원래 값과 같아지는지 테스트).
- 결정: 원래 statusline 명령은 `-- <명령>` 인자 대신 `%APPDATA%\LaDockridge.json`(`original`, `hadStatusLine`)에 저장하고 브리지가 거기서 읽는다. Claude Code가 셸을 거쳐 실행하므로 인용부호가 겹치는 걸 피하기 위해. 원래 명령은 `cmd /D /S /C`로 실행.
- 결정: 원래 statusline이 없으면 출력 없이 종료(0). 해제할 때는 `statusLine` 키를 지운다.
- 결정: `rate_limits` 창이 하나도 없는 입력(첫 응답 전)은 저장하지 않아 기존 스냅샷을 덮어쓰지 않는다. 한도 창 하나만 있으면 그것만 저장.
- 결정: `claude_bridge_connect(confirm)` — `confirm: true`가 아니면 거부. 확인 대화상자 자체는 UI(M2-05)에서 만든다. 앱 시작 때 `stale`(실행 파일 경로가 다름)이면 `claude-bridge://changed` 이벤트를 보내지만 구독하는 UI는 아직 없음.
- 측정(dev 빌드, 이 PC): 브리지 경유 0.175초 vs `statusline.js` 직접 0.100초 → 오버헤드 약 75ms. 출력은 `cmp`로 동일, `limits/claude.json` 저장 확인. release 빌드 미측정.
- 남은 것: 실제 연결 · 해제 왕복, 파일 감시 이벤트, `statusline.js` 표시와 % 비교 → 앱을 띄워 확인해야 하므로 상태는 🟨 유지. 설정 화면의 대안 안내(statusline.js 한 줄 추가)는 M3-02/M2-05에서.

- 2026-10-19 **검증**:
  - 연결 · 해제: 임시 홈(`USERPROFILE`/`APPDATA`)에서 이 PC의 실제 `settings.json`(원래 명령으로 되돌린 사본)을 대상으로 `connect_disconnect_roundtrip_in_temp_home`(ignored 테스트, 테스트 exe를 환경변수 지정해 직접 실행) 통과: 확인 없이 `connect(false)`는 거부되고 파일이 안 바뀜 → 연결하면 `statusLine` 외 키가 그대로 → 백업 생성 → 두 번 연결해도 원래 명령 보존 → 해제 후 **바이트 단위로 원본과 동일**(LF · CRLF 둘 다). 실제 `~/.claude/settings.json`은 건드리지 않았다.
  - 발견·수정: 원본이 CRLF면 연결/해제할 때 LF로 바뀌던 것을 원본 줄바꿈을 보존하도록 고침(`write_settings`).
  - 표시 값: 임시 `APPDATA`로 `ladock.exe statusline-bridge`에 샘플 입력(5H 37.5% · 7D 12.25%)을 넣으면 원래 `statusline.js`와 **출력이 바이트 단위로 같고**(`cmp`), 144ms, `claude.json`에 같은 값이 저장됨. `statusline.js`는 5H 38% · 7D 12%로 표시하고 LaDock도 반올림해 38% · 12%로 표시 → 일치.
  - 이 PC의 실제 `settings.json`은 이미 브리지에 연결돼 있고 `limits/claude.json`이 실제 Claude Code 세션으로 갱신되는 것을 확인(팝오버 값 16% · 6%).
  - 파일 감시 → `limits://changed`: `watchers_emit_events_in_temp_home`(ignored, 아래 M2-01 참고)에서 `claude.json`을 바꾼 뒤 0.3초 만에 이벤트.
  - **미확인**: "연결 전후 Claude Code 경유 statusline 출력이 바이트 단위로 같음"은 Claude Code가 직접 실행하는 경로라 여기서 확인하지 못함(브리지 CLI 직접 실행으로만 확인).
- 2026-10-19 사용자 결정으로 완료 처리. "Claude Code가 직접 실행하는 경로에서 statusline 출력이 바이트 단위로 같음"은 이 환경에서 확인하지 못해 체크하지 않고 남김(브리지 CLI 직접 실행으로는 동일). 대안 안내는 M3-02로 이동.

# M2-01 AI 구독 감지

- 마일스톤: M2 AI 구독·한도 · 의존: M0-01
- 참고: [architecture.md › 데이터 모델](../architecture.md#데이터-모델) (`ProviderStatus`), [› 보안 경계](../architecture.md#보안-경계)
- 열린 결정: **Codex 설치 여부** — INDEX "열린 결정" 참고

## 목표
PC에 설치된 AI CLI와 로그인 · 구독 상태를 자동으로 알아낸다. 토큰은 절대 밖으로 꺼내지 않는다.

## 할 일
- [ ] `providers_detect` 명령 → `ProviderStatus[]`
- [ ] provider별 감지 모듈 (`providers/{claude,gemini,antigravity,codex}.rs`)
- [ ] 실행 파일 찾기(PATH + 알려진 경로) → `--version` (타임아웃 5초)
- [ ] 인증 파일은 읽기 전용, **허용된 필드만** 파싱 (아래 표)
- [ ] 경고: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`가 환경변수에 있으면 `warnings`에 추가
- [ ] 다시 감지 시점: 앱 시작, 설정 파일 변경 감시(`notify` crate) → `providers://changed`, 수동 새로고침(M2-05)
- [ ] 보안 테스트: IPC 응답 · 로그에 토큰 문자열이 없는지

## 감지 방법 (2026-10-19, 이 PC에서 확인)

| Provider | 실행 파일 | 버전 | 인증 · 구독 판별 (허용 필드) | 이 PC | 검증 |
| --- | --- | --- | --- | --- | --- |
| Claude Code | `claude` — `~\.local\bin\claude.exe` | `2.1.303` | `~\.claude\.credentials.json` → `claudeAiOauth.subscriptionType`, `rateLimitTier`, `expiresAt` | **Pro** 구독 | ✅ |
| Gemini CLI | `gemini` — npm 전역 (`gemini.ps1`) | `0.58.0` | `~\.gemini\settings.json` → `security.auth.selectedType` (`oauth-personal` / `gemini-api-key` / `vertex-ai`), `oauth_creds.json` 존재 여부, `google_accounts.json` → 활성 계정 | Google OAuth | ✅ |
| Antigravity CLI | `agy` — `%LOCALAPPDATA%\agy\bin\agy.exe` | `1.3.3` | `~\.gemini\antigravity-cli\` 존재 + **`agy models` 성공 여부**(타임아웃 10초)로 로그인 판단 | 설치됨 | ⚠️ 판별 방식 확인 필요 |
| Codex | `codex` | – | `codex login status` 출력, `~\.codex\auth.json` → `auth_mode` (`chatgpt` = 구독 / `apikey`) | **미설치** (`~\.codex\skills`만 있음) | ⚠️ 설치 후 검증 |

- Gemini CLI 공식 문서: "2026-06-18부로 Antigravity CLI로 대체됨" → Gemini는 레거시로 취급, agy를 우선으로 다듬는다.
- `gemini`는 `.ps1` 래퍼라서 실행할 때 `pwsh -File` 등이 필요할 수 있음 → 확인
- Codex 미설치면 `installHint: "npm i -g @openai/codex"`

## 명세
- 판별에 실패해도 실행은 막지 않는다 → `auth: 'unknown'` + `evidence`에 이유
- `evidence`는 UI에 그대로 보여줄 수 있게 짧은 한국어 문장 + 파일 경로

## 완료 기준
- [ ] 이 PC에서: Claude = subscription(pro), Gemini = subscription(oauth-personal), agy = 설치 + 인증 판별 결과 기록, Codex = 미설치
- [ ] 인증 파일을 바꾸면(예: 로그아웃) 몇 초 안에 상태가 바뀜
- [ ] 토큰 문자열이 IPC · 로그 어디에도 없음 (테스트로 확인)

## 작업 기록
- 2026-10-19 결정 D3: Codex는 설치하지 않고 미설치 카드만 표시한다.

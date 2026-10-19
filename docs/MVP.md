# LaDock — MVP 기획

> **이 문서는 기획 원본이다 (2026-10-19 기준, 동결).** 개발할 때는 이 문서 대신
> [`milestones/INDEX.md`](./milestones/INDEX.md) → 해당 기능 파일, 공용 정의는 [`architecture.md`](./architecture.md)를 본다.
> 이후 바뀐 명세는 그쪽에만 반영한다.

> 내 PC에 깔린 AI 구독(Claude Code · Codex · Gemini CLI · Antigravity)을 알아서 인식하고,
> psmux처럼 **세션 → 탭 → 분할 pane** 구조의 터미널 안에서 바로 띄워 쓰는 나만의 Windows 앱.

- 작성일: 2026-10-19
- 스택: Tauri v2 + Rust · React + TypeScript · xterm.js
- 디자인 시안: [`design-mvp.html`](./design-mvp.html) (브라우저로 열기, 반응형/인터랙티브)

---

## 1. 원칙

| 원칙 | 의미 |
| --- | --- |
| **가볍게** | Orca처럼 다 하려 하지 않는다. 터미널 + AI 실행기에 집중. 기동 1초 이내, 유휴 메모리 낮게. |
| **터미널이 1급 시민** | 모든 AI 에이전트는 "공식 CLI를 pane 안에서 실행"하는 방식으로만 다룬다. |
| **공식 CLI 그대로** | 구독 토큰을 꺼내서 API를 직접 호출하지 않는다. 인증·과금은 각 CLI가 처리하고 LaDock은 *인식과 실행*만 한다. (약관·보안 모두 이쪽이 안전) |
| **키보드 우선** | psmux/tmux식 prefix 키(`Ctrl+B`)로 손을 마우스로 옮기지 않고 전부 조작. 마우스는 보조. |
| **내 PC 기준** | 범용 제품이 아니다. Windows 11 + 내가 쓰는 셸/CLI만 확실히 지원한다. |

## 2. MVP 범위

### 포함 (In)
1. **앱 내 터미널** — ConPTY 기반 실제 셸 (pwsh, Windows PowerShell, cmd, Git Bash, WSL)
2. **세션 → 탭 → pane 3단 구조** (tmux의 session → window → pane과 같음)
   - 세션: 작업 맥락 단위 (예: `LaDock` 개발, `CS업무`) — 생성 / 전환 / 이름 변경 / 닫기
   - 탭: 세션 안의 화면 하나 (tmux의 window) — 생성 / 전환 / 이름 변경 / 닫기
3. **pane 분할** — 탭 안에서 세로·가로 분할, 드래그 리사이즈, 포커스 이동, 줌, 닫기
4. **AI 구독 인식 + 한도** — 설치 여부, 버전, 로그인/구독 상태를 자동 감지하고, 상태바에 마우스를 올리면 구독 한도(5시간 · 주간 · 일일) 사용률과 리셋까지 남은 시간 표시
5. **AI 실행** — 인식된 CLI를 새 pane / 새 탭으로 원클릭(또는 키) 실행
6. **레이아웃 복원** — 앱 재시작 시 탭·분할 구조·작업 폴더·실행 명령 복원
7. **기본 설정** — 기본 셸, 폰트, 테마, prefix 키

### 제외 (Out) — 의도적으로 안 함
- ❌ git worktree 자동화 (사용 안 함)
- ❌ 에이전트 간 오케스트레이션 / 작업 핸드오프
- ❌ 내장 브라우저, diff 뷰어, PR 연동
- ❌ tmux식 detach(앱 꺼도 프로세스 유지) — Phase 2 검토
- ❌ 구독 토큰을 이용한 API 직접 호출

---

## 3. 기능 명세

### 3.1 터미널 엔진
- Rust `portable-pty`로 ConPTY 생성, pane 1개 = PTY 1개.
- PTY 출력은 리더 스레드에서 **16ms 또는 64KB 단위로 묶어** `tauri::ipc::Channel`로 스트리밍 (이벤트 남발 방지).
- 프론트는 `@xterm/xterm` + addon: `fit`, `webgl`, `unicode11`(한글 폭), `search`, `web-links`.
- 숨겨진 탭의 터미널도 **언마운트하지 않음** (`display:none` 유지, 다시 보일 때 `fit()`). PTY는 계속 동작.
- 복사/붙여넣기: 선택 시 자동 복사(옵션), `Ctrl+Shift+C/V`, 우클릭 붙여넣기.
- pane 종료 시 `[프로세스 종료: code N] — Enter로 재시작, x로 닫기` 표시.

### 3.2 세션 · 탭 · pane
```
세션 (LaDock)              ← 사이드바 트리 / 타이틀바 세션 버튼 / Ctrl+B s
 ├─ 탭 1: dev              ← 타이틀바 탭 (현재 세션의 탭만 표시)
 │   └─ 분할 트리: claude │ pwsh / agy
 └─ 탭 2: build
세션 (CS업무)
 ├─ 탭 1: ticket
 └─ 탭 2: pwsh (자동 이름)
```
- **세션**: 작업 맥락. 이름 · 색상 점 · 탭 목록 · 활성 탭을 가짐. 새 세션은 현재 pane의 cwd를 물려받고, 만들자마자 이름 입력 상태가 됨.
- **탭(윈도우)**: 탭 하나 = **이진 분할 트리** 하나. 이름을 비워두면 tmux `automatic-rename`처럼 포커스된 pane의 프로그램 이름(`claude`, `pwsh`…)을 따라감.
- 분할 노드: `방향(row|col) + 비율 + 자식 2개`, 리프: pane.
- pane 닫으면 형제 노드가 부모 자리로 승격 → 탭의 마지막 pane이 닫히면 탭이 닫힘 → 세션의 마지막 탭이 닫히면 세션이 닫힘.
- 다른 세션으로 전환해도 그 세션의 PTY는 계속 동작 (출력이 쌓이면 사이드바에 활동 표시 — Phase 2에서 알림과 연결).
- 줌: 포커스된 pane만 전체 표시 (트리는 유지).
- 포커스 이동: 방향키 기준으로 **화면상 가장 가까운 pane** 선택 (트리 순서가 아닌 기하 기준).
- 각 pane 헤더: 종류 아이콘(셸/AI), 제목, cwd, 활동 표시(출력 중 ●), [분할 ▸ / 분할 ▾ / 줌 / 닫기].

### 3.3 키바인딩 (psmux/tmux 호환, prefix 변경 가능)

| 키 | 동작 | 비고 |
| --- | --- | --- |
| `Ctrl+B` `s` / `w` | 세션 · 탭 트리 열기 (↑↓ Enter로 전환) | tmux choose-tree |
| `Ctrl+B` `C` | 새 세션 | LaDock 확장 |
| `Ctrl+B` `$` | 세션 이름 변경 | |
| `Ctrl+B` `(` / `)` | 이전 / 다음 세션 | |
| `Ctrl+B` `X` | 세션 닫기 | LaDock 확장 |
| `Ctrl+B` `c` | 새 탭 | |
| `Ctrl+B` `,` | 탭 이름 변경 | |
| `Ctrl+B` `n` / `p` | 다음 / 이전 탭 | |
| `Ctrl+B` `0`–`9` | N번 탭으로 이동 | |
| `Ctrl+B` `&` | 탭 닫기 | |
| `Ctrl+B` `%` | 좌우 분할 (오른쪽에 새 pane) |
| `Ctrl+B` `"` | 상하 분할 (아래에 새 pane) | |
| `Ctrl+B` `←↑→↓` | pane 포커스 이동 | |
| `Ctrl+B` `Ctrl+←↑→↓` | pane 크기 조절 | |
| `Ctrl+B` `z` | pane 줌 토글 | |
| `Ctrl+B` `x` | pane 닫기 | |
| `Ctrl+B` `a` | AI 실행 팔레트 (claude / codex / gemini / agy 선택) | LaDock 확장 |
| `Ctrl+B` `?` | 단축키 도움말 | |
| `Ctrl+B` `Ctrl+B` | 터미널에 `Ctrl+B` 그대로 전달 | |

> 표의 "LaDock 확장" 키는 tmux 기본 키가 아니라 LaDock에서 새로 정한 키예요 (tmux는 새 세션을 명령어로 만들고, 기본 단축키가 없음).

- 구현: xterm `attachCustomKeyEventHandler`에서 prefix를 가로채고, prefix 상태는 2초 후 자동 해제.
- 상태바에 `PREFIX` 표시가 켜져서 지금 prefix 대기 중인지 보이게.

### 3.4 AI 구독 인식 ★ MVP 핵심

**동작:** 앱 시작 시 + 사이드바 "다시 감지" + 설정 파일 변경 감시(`notify` crate) 시 재감지.

**보안 규칙**
- 인증 파일은 **읽기 전용**, Rust에서 파싱하고 **허용된 메타데이터 필드만** 프론트로 넘긴다.
- 토큰 값(access/refresh/id token)은 IPC를 넘지 않고, 로그에 남기지 않고, 저장하지 않는다.

**감지 방법** (2026-10-19, 이 PC에서 확인한 결과)

| Provider | 실행 파일 | 설치/버전 | 인증·구독 판별 근거 | 이 PC 상태 | 검증 |
| --- | --- | --- | --- | --- | --- |
| Claude Code | `claude` (`~\.local\bin\claude.exe`) | `claude --version` → `2.1.303` | `~\.claude\.credentials.json` → `claudeAiOauth.subscriptionType`, `rateLimitTier`, `expiresAt` | **Pro 구독** 로그인 | ✅ |
| Gemini CLI | `gemini` (npm 전역) | `gemini --version` → `0.58.0` | `~\.gemini\settings.json` → `security.auth.selectedType` (`oauth-personal` / `gemini-api-key` / `vertex-ai`), `oauth_creds.json` 존재, `google_accounts.json` → 계정 | Google OAuth 로그인 | ✅ |
| Antigravity CLI | `agy` (`%LOCALAPPDATA%\agy\bin\agy.exe`) | `agy --version` → `1.3.3` | `~\.gemini\antigravity-cli\` 존재 + **`agy models` 성공 여부**로 로그인 확인 (타임아웃 10초) | 설치됨 | ⚠️ 인증 판별 방식 확인 필요 |
| Codex | `codex` | `codex --version` | `codex login status` 출력, `~\.codex\auth.json` → `auth_mode` (`chatgpt` = 구독 / `apikey`) | **미설치** (`~\.codex\skills`만 있음) | ⚠️ 설치 후 검증 |

**상태 정의**

```ts
type ProviderId = 'claude' | 'codex' | 'gemini' | 'antigravity';
type AuthState = 'subscription' | 'api_key' | 'logged_out' | 'unknown';

interface ProviderStatus {
  id: ProviderId;
  installed: boolean;
  binPath?: string;
  version?: string;
  auth: AuthState;
  plan?: string;        // 'pro' | 'max' | 'plus' ... (알 수 있을 때만)
  account?: string;     // 표시용 계정 (gemini 등)
  evidence: string;     // 판별 근거: "~/.claude/.credentials.json: subscriptionType"
  warnings: string[];   // 예: "ANTHROPIC_API_KEY 환경변수가 설정됨 → API 과금 가능"
  checkedAt: number;
}
```

**과금 실수 방지 (나만을 위한 기능)**
- `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`가 환경변수에 있으면 경고 배지를 띄운다.
- provider별 옵션 **"구독으로만 실행"**: pane을 띄울 때 해당 API 키 환경변수를 제거하고 실행한다 (기본 ON).

**UI 표시** — 사이드바에 따로 영역을 두지 않고 **상태바 오른쪽 한도 표시**로 통합
- 상태바: 구독 중인 AI의 아이콘과 한도 사용률을 작게 표시 (`✻ 5H 24% 7D 41% ● ✦ 1D 1% ●`), 점 색 = 가장 많이 쓴 한도의 상태
- **마우스를 올리면 한도 팝오버**, 클릭하면 고정 (터치 화면은 클릭만), `Esc`나 바깥 클릭으로 닫기
- 팝오버 내용 (provider별):
  - 이름 · 플랜 배지(🟢 구독 / 🟡 확인 필요·API 키 경고 / ⚪ 로그아웃) · [▶ 실행]
  - 한도별 게이지: 사용률 % · 상태 글자(여유 < 70% ≤ 주의 < 90% ≤ 임박) · 남은 % · **리셋까지 남은 시간**
  - 출처 태그: `공식` / `추정` + 마지막 갱신 시각
  - 미설치 provider는 한 줄로: `Codex · 미설치 [설치 명령]`
  - 하단: "구독으로만 실행" 토글
- 다시 확인 버튼 = 한도 다시 읽기 + 구독 다시 감지. 리셋까지 남은 시간은 30초마다 갱신.

### 3.4.1 한도 가져오기 (5시간 · 주간 · 일일)
구독 토큰으로 비공개 API를 호출하지 않고, **각 CLI가 공식으로 내주는 데이터**만 쓴다. (2026-10-19 조사)

| Provider | 한도 | 출처 | 검증 |
| --- | --- | --- | --- |
| Claude Code | 5시간 · 주간 (`used_percentage`, `resets_at`) | **공식 statusline JSON**의 `rate_limits.five_hour`, `rate_limits.seven_day` — Pro/Max 구독자에게만, 세션의 첫 응답 이후부터 제공 | ✅ 공식 문서 · 이 PC의 `statusline.js`가 이미 같은 값을 표시 중 |
| Codex | 5시간 · 주간 | `~\.codex\sessions\YYYY\MM\DD\*.jsonl`의 `token_count` 이벤트에 있는 `rate_limits` (커뮤니티 도구들의 설명) | ⚠️ 미설치 — 설치 후 실제 키 확인 |
| Gemini CLI | 일일 요청 수 | 공식 한도표(개인 무료 1,000 / AI Pro 1,500 / AI Ultra 2,000회) ÷ 오늘 로컬 로그의 요청 수 → **추정** | ⚠️ 추정 · 리셋 시각은 공식 문서에 없음 · 플랜은 설정에서 선택 |
| Antigravity CLI | ? | CLI 로그에 `quota_manager`는 있지만 값은 남기지 않음 | ❌ 출처 없음 → "한도 정보 없음" 표시 |

> Gemini CLI 공식 문서에는 "2026-06-18부로 Antigravity CLI로 대체됨"이라고 적혀 있다. Google 쪽은 앞으로 agy의 한도 출처를 찾는 게 더 중요하다.

**Claude 연동 방식 — statusline 브리지**
- Claude Code는 statusline 명령의 stdin으로 `rate_limits`가 포함된 JSON을 넘긴다. LaDock은 이 명령을 감싸는 브리지를 둔다:
  ```
  기존: node "C:/Users/YeonJun/.claude/statusline.js"
  연결 후: ladock.exe statusline-bridge -- node "C:/Users/YeonJun/.claude/statusline.js"
  ```
  브리지는 stdin JSON에서 `rate_limits`와 `session_id`만 뽑아 `%APPDATA%\LaDock\limits\claude.json`에 저장하고, 같은 stdin을 원래 명령에 넘겨 **기존 statusline 출력을 그대로 유지**한다.
- `~/.claude/settings.json`을 바꾸는 일이라 **첫 실행 때 사용자 확인 후 연결**하고, 원래 설정은 백업해 둔다. 팝오버와 설정에 [연결 해제] (원래대로 복구) 버튼을 둔다.
- 대안: 브리지 없이 기존 `statusline.js`에 한 줄을 추가해서 같은 파일을 쓰게 하는 방법 (설정에서 안내).
- 갱신: Claude Code 세션이 응답할 때마다 (LaDock 밖에서 실행한 세션 포함). 여러 세션이면 가장 최근 값을 쓴다.
- 오래된 값 처리: `resets_at`이 지나면 "리셋됨 · 다음 응답 때 갱신"으로 표시하고, 마지막 갱신 시각을 항상 같이 보여준다.

### 3.5 AI 실행
- 실행 = **셸 프로필 + 명령**으로 새 pane 생성. 기본은 PTY에서 `claude.exe` 등을 직접 실행하고, 옵션으로 셸 안에서 실행해 CLI가 끝나면 셸 프롬프트로 돌아오게 할 수 있다.
- provider별 기본 인자 설정: 모델(`--model`), 이어하기(`claude -c`, `agy -c`), effort(`agy --effort`) 등.
- 작업 폴더: 포커스된 pane의 cwd를 상속 (OSC 7 / 프롬프트 훅으로 추적, 안 되면 시작 cwd).
- 실행 팔레트(`Ctrl+B a`): provider → 위치(오른쪽 분할 / 아래 분할 / 현재 세션에 새 탭) 순으로 키 2번이면 실행.

### 3.6 셸 프로필 자동 감지
- `pwsh`(7.x), `powershell`(5.1), `cmd`, Git Bash(`C:\Program Files\Git\bin\bash.exe`), WSL 배포판(`wsl -l -q`).
- 기본 셸은 설정에서 선택 (기본값 pwsh).

### 3.7 레이아웃 복원
- `%APPDATA%\LaDock\state.json`에 세션 → 탭 → 분할 트리 · 비율 · 활성 세션/탭 · pane별 `{profile, cwd, command}` 저장 (디바운스 1초).
- 재시작 시 같은 구조로 **새 프로세스를 띄워 복원** (프로세스 자체는 복원 안 됨).
- AI pane은 복원 시 이어하기 옵션 제공: "이전 대화 이어서 열기" → `claude -c` / `agy -c`.

### 3.8 설정 (MVP 최소)
- 기본 셸, 폰트 패밀리/크기(기본 Cascadia Code 13), 테마(다크/라이트/시스템), prefix 키, 선택 시 자동 복사, provider별 기본 인자, 구독으로만 실행 on/off.
- 저장: `%APPDATA%\LaDock\settings.json`

---

## 4. 화면 구성

```
┌──────────────────────────────────────────────────────────────┐
│ ◆ LaDock [● LaDock ▾] │ [1 dev] [2 build] [+]      ◐ ─ □ ✕ │ ← 세션 버튼 + 현재 세션의 탭
├─────────────┬────────────────────────────────────────────────┤
│ 세션        │ ┌ ✻ claude ─ C:\Laoh ─────┐┌ >_ pwsh ─────────┐ │
│ ▾ ● LaDock  │ │ ✻ Claude Code  Pro      ││ PS C:\Laoh>      │ │
│   │ 1 dev   │ │ › ...                   ││                  │ │
│   │ 2 build │ │                         │├──────────────────┤ │
│ › ● CS업무  │ │                         ││ ▲ agy            │ │
│ › ● stock   │ │                         ││ › ...            │ │
│ 셸 프로필   │ └─────────────────────────┘└──────────────────┘ │
│  >_ pwsh    │                     ┌ AI 한도 ───────────────┐  │
│  C: cmd …   │                     │ ✻ 5시간 ███░░░░ 24%    │  │ ← hover 팝오버
│             │                     │   주간  █████░░ 41%    │  │
│             │                     │ ✦ 일일  ░░░░░░░  1% 추정│  │
├─────────────┴─────────────────────┴────────────────────────┴─┤
│ PREFIX │ ● LaDock 1:dev* 2:build │ pane 1/3  ✻5H 24% 7D 41% │ ← 상태바
└──────────────────────────────────────────────────────────────┘
```
- 사이드바 세션 트리: 활성 세션만 펼쳐서 탭 목록 표시, 나머지는 접힘 (탭 수 · 실행 중인 AI 아이콘 표시).
- 타이틀바 세션 버튼: 사이드바가 닫혀 있거나 좁은 화면에서도 세션 전환 가능 (클릭 → 세션 · 탭 트리).

**반응형 기준** (창 크기를 줄여서 쓰는 경우 대응)

| 폭 | 레이아웃 |
| --- | --- |
| ≥ 1024px | 사이드바 고정 + 분할 pane 전부 표시 |
| 640–1023px | 사이드바는 ☰로 여닫는 오버레이 드로어, pane 분할은 그대로 |
| < 640px | **스택 모드**: 포커스된 pane 하나만 전체 표시 + 상단 pane 칩으로 전환, 단축키 힌트 숨김 |

- 타이틀바는 커스텀(Tauri `decorations: false`) + 드래그 영역 지정.
- 다크 테마 기본, 라이트/시스템 지원. 터미널 색상은 앱 테마와 연동.

---

## 5. 아키텍처

```
React (UI)
 ├─ store (zustand): sessions[], layoutTree, focus, providers, settings
 ├─ <TerminalPane> : xterm 인스턴스 ↔ Channel
 └─ keybinding layer (prefix FSM)
        │  invoke / Channel / event
Tauri v2 (Rust)
 ├─ pty      : spawn / write / resize / kill, 출력 배칭
 ├─ providers: 감지(파일 파싱 + --version 실행), 파일 감시
 ├─ shells   : 셸 프로필 감지
 └─ store    : state.json / settings.json 읽기·쓰기
```

**IPC 명령**

| 명령 | 입력 | 출력 |
| --- | --- | --- |
| `pty_spawn` | `{ profileId, command?, args?, cwd, cols, rows, envRemove[] }`, `onData: Channel<Uint8Array>` | `paneId` |
| `pty_write` | `{ paneId, data }` | – |
| `pty_resize` | `{ paneId, cols, rows }` | – |
| `pty_kill` | `{ paneId }` | – |
| 이벤트 `pty://exit` | – | `{ paneId, code }` |
| `providers_detect` | – | `ProviderStatus[]` |
| `limits_get` | `{ force?: boolean }` | `LimitStatus[]` — provider별 `{ windows: [{ key: '5h'\|'7d'\|'1d', usedPct, resetsAt?, used?, limit? }], source: 'official'\|'estimate'\|'none', updatedAt }` |
| 이벤트 `limits://changed` | – | `LimitStatus[]` (브리지 파일이 바뀔 때) |
| `claude_bridge_connect` / `_disconnect` | – | statusline 브리지 연결 / 원래 설정으로 복구 |
| 이벤트 `providers://changed` | – | `ProviderStatus[]` |
| `shells_detect` | – | `ShellProfile[]` |
| `state_load` / `state_save` | `AppState` | `AppState` |

**데이터 모델**

```ts
type LayoutNode =
  | { type: 'pane'; paneId: string }
  | { type: 'split'; dir: 'row' | 'col'; ratio: number; a: LayoutNode; b: LayoutNode };

interface PaneSpec {
  id: string;
  kind: 'shell' | 'agent';
  provider?: ProviderId;
  profileId: string;      // 'pwsh' | 'cmd' | 'wsl:Ubuntu' ...
  command?: string;
  args?: string[];
  cwd: string;
  title?: string;
}

interface Window {                // UI에서는 "탭"
  id: string;
  name: string | null;            // null이면 포커스된 pane의 프로그램 이름을 따라감
  root: LayoutNode;
  focusPaneId: string;
  zoomed: boolean;
}

interface Session {
  id: string;
  name: string;
  color: string;
  windows: Window[];
  activeWindowId: string;
}

interface AppState { sessions: Session[]; activeSessionId: string; panes: Record<string, PaneSpec>; }
```

**예정 폴더 구조**

```
LaDock/
├─ CLAUDE.md
├─ docs/                   # MVP.md, design-mvp.html, architecture.md, milestones/
├─ src/                    # React
│  ├─ app/  components/  features/{terminal,layout,providers,keys}/  store/
└─ src-tauri/
   └─ src/{main.rs, pty.rs, providers/{mod,claude,codex,gemini,antigravity}.rs, shells.rs, store.rs}
```

---

## 6. 마일스톤

> 기능 단위로 쪼갠 목록과 진행 상태는 [`milestones/INDEX.md`](./milestones/INDEX.md)에 있다.

| 단계 | 내용 | 완료 기준 |
| --- | --- | --- |
| **M0 스캐폴드** | Tauri v2 + React + Vite 셋업, pane 1개에 pwsh | pwsh에서 `ls`, `vim`, 한글 입력/출력 정상, 리사이즈 시 깨짐 없음 |
| **M1 세션·탭·pane** | 세션/탭 모델, 분할 트리, 키바인딩, 세션 트리, 드래그 리사이즈, 줌, 포커스 이동 | 3세션 × 2탭 × 3pane에서 모든 단축키 동작, 다른 세션·탭으로 가 있어도 출력 유지 |
| **M2 AI 구독·한도** | provider 감지, Claude statusline 브리지, Gemini 일일 추정, 상태바 한도 팝오버, 실행 팔레트, 구독으로만 실행 | 이 PC에서 Claude 5시간·주간 %가 기존 `statusline.js` 표시와 같은 값으로 나오고, 기존 statusline 출력이 그대로 유지되며, 클릭 한 번으로 pane 실행 |
| **M3 복원·설정** | state/settings 저장, 재시작 복원, 테마/폰트/prefix | 앱 재시작 후 같은 레이아웃·cwd로 복원, AI pane 이어하기 동작 |

→ M3까지 끝나면 **MVP 완료 = 매일 쓰는 터미널을 LaDock으로 바꿀 수 있는 상태.**

---

## 7. 리스크 & 대응

| 리스크 | 대응 |
| --- | --- |
| xterm.js 한글 IME 조합 문제 (조합 중 글자 중복/누락) | M0에서 제일 먼저 검증. `unicode11` + composition 이벤트 처리 확인, 안 되면 xterm 버전/옵션 교체 |
| WebGL 컨텍스트 한도 (WebView2 약 16개) → pane이 많으면 렌더러가 죽음 | 보이는 pane만 WebGL, 숨긴 탭은 DOM 렌더러로 전환 / 컨텍스트 소실 시 자동 폴백 |
| ConPTY 특이사항 (리사이즈 리플로, Ctrl+C 전달, 종료 감지) | `portable-pty` 이슈 기준으로 회귀 테스트 목록 작성 |
| 인증 파일 포맷이 CLI 업데이트로 바뀜 | 필드 없으면 `unknown`으로 표시(실패해도 실행은 가능), 판별 근거를 UI에 보여줘서 바로 알아챔 |
| statusline 브리지가 기존 statusline을 깨뜨림 / Claude Code가 설정을 바꿈 | 브리지는 실패해도 원래 명령은 항상 실행, 설정 백업 + 연결 해제 버튼, 앱 시작 때 연결 상태 점검 |
| Claude Code를 한동안 안 쓰면 한도 값이 오래됨 | 마지막 갱신 시각 항상 표시, `resets_at`이 지나면 "리셋됨"으로 표시 |
| Codex·Antigravity 인증 판별 미검증 | M2에서 설치/로그인 후 실제 파일·명령으로 확정, 문서 표 업데이트 |
| 출력 폭주 (빌드 로그 등)로 UI 버벅임 | Rust 쪽 배칭 + xterm write 콜백 기반 흐름 제어 |

---

## 8. Phase 2 백로그 (MVP 이후)
- **에이전트 상태 감지**: Claude Code hooks(`Stop`, `Notification`) / Codex `notify` → 로컬 소켓으로 LaDock에 신호 → pane 헤더에 `작업 중 / 입력 대기 / 완료` 표시 + Windows 토스트 알림
- 출력 무변화 N초 휴리스틱 (hook 없는 CLI용)
- Antigravity 한도 출처 찾기 (agy 안의 명령, 공식 문서, 로그 확인)
- Codex 한도 연동 (설치 후 세션 로그의 `rate_limits` 확인)
- 한도 임박(90%) 시 Windows 토스트 알림
- 커맨드 팔레트 (`Ctrl+Shift+P`), 스니펫/자주 쓰는 명령
- detach 모드: 백그라운드 데몬이 PTY 보유 → 앱을 꺼도 세션 유지 (psmux와 같은 방식)
- 스크롤백 검색 UI, pane 출력 저장
- 업무 자동화 연결 (예: `cs-lookup` 같은 스킬을 실행하는 프리셋 pane)

---

## 9. 결정이 필요한 것
1. ~~워크스페이스 개념을 둘지~~ → **결정: 세션 → 탭 → pane 3단 구조, 세션이 작업 맥락(워크스페이스) 역할** (2026-10-19)
2. AI pane이 종료되면 → pane 닫기 / 셸로 떨어지기 / 재시작 안내 중 기본값을 뭘로 할지
3. prefix를 `Ctrl+B`(tmux 습관)로 둘지, 다른 키로 바꿀지 (Claude Code 등 CLI 단축키와 겹침 여부 확인 필요)
4. Codex 설치 계획이 있는지 (없으면 M2에서 카드만 두고 검증은 미룸)

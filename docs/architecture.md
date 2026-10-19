# LaDock 아키텍처 (공용 참조)

> 여러 기능이 같이 쓰는 구조 · 타입 · IPC · 저장 위치를 모아둔 문서. 기능 파일에서 필요한 절만 링크로 참조한다.
> 타입이나 IPC가 바뀌면 **이 문서를 먼저 고치고** 코드를 맞춘다.

## 레이어

```
React (UI)
 ├─ store (zustand): sessions[] → windows[] → layout tree, panes{}, providers, limits, settings
 ├─ <TerminalPane> : xterm 인스턴스 ↔ Channel
 └─ keybinding layer (prefix FSM)
        │  invoke / Channel / event
Tauri v2 (Rust)
 ├─ pty       : spawn / write / resize / kill, 출력 배칭
 ├─ shells    : 셸 프로필 감지
 ├─ providers : 구독 감지 (파일 파싱 + --version), 파일 감시
 ├─ limits    : 한도 읽기 (Claude 브리지 파일, Gemini 추정)
 ├─ bridge    : `ladock.exe statusline-bridge` 서브커맨드 (창 없이 실행)
 └─ store     : state.json / settings.json 읽기·쓰기
```

## 폴더 구조 (예정 — M0-01에서 확정 후 갱신)

```
LaDock/
├─ CLAUDE.md
├─ docs/
│  ├─ MVP.md                # 기획 원본 (동결)
│  ├─ design-mvp.html       # 인터랙티브 디자인 시안
│  ├─ architecture.md       # 이 문서
│  └─ milestones/           # INDEX.md + 기능별 파일
├─ src/                     # React
│  ├─ app/  components/  store/
│  └─ features/{terminal,layout,keys,sessions,providers,limits,settings}/
└─ src-tauri/
   └─ src/{main.rs, pty.rs, shells.rs, store.rs, bridge.rs,
           providers/{mod,claude,codex,gemini,antigravity}.rs,
           limits/{mod,claude,gemini}.rs}
```

## 저장 위치

| 경로 | 내용 | 담당 기능 |
| --- | --- | --- |
| `%APPDATA%\LaDock\state.json` | 세션 · 탭 · 분할 트리 · pane 스펙 | M3-01 |
| `%APPDATA%\LaDock\settings.json` | 설정 | M3-02 |
| `%APPDATA%\LaDock\limits\claude.json` | statusline 브리지가 쓴 `rate_limits` 스냅샷 | M2-03 |
| `%APPDATA%\LaDock\backups\` | 사용자 설정 파일을 바꾸기 전 백업 (예: `~/.claude/settings.json`) | M2-03 |

## 데이터 모델

```ts
// ── 레이아웃 ─────────────────────────────────────
type LayoutNode =
  | { type: 'pane'; paneId: string }
  | { type: 'split'; dir: 'row' | 'col'; ratio: number; a: LayoutNode; b: LayoutNode };  // ratio 0.15–0.85

interface PaneSpec {
  id: string;
  kind: 'shell' | 'agent';
  provider?: ProviderId;
  profileId: string;          // 'pwsh' | 'powershell' | 'cmd' | 'bash' | 'wsl:Ubuntu' ...
  command?: string;
  args?: string[];
  cwd: string;
  title?: string;
}

interface Window {            // UI에서는 "탭"
  id: string;
  name: string | null;        // null이면 포커스된 pane의 프로그램 이름을 따라감 (auto-rename)
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

// ── 셸 ───────────────────────────────────────────
interface ShellProfile { id: string; name: string; path: string; args: string[]; isDefault: boolean; }

// ── AI 구독 ──────────────────────────────────────
type ProviderId = 'claude' | 'codex' | 'gemini' | 'antigravity';
type AuthState = 'subscription' | 'api_key' | 'logged_out' | 'unknown';

interface ProviderStatus {
  id: ProviderId;
  installed: boolean;
  binPath?: string;
  version?: string;
  auth: AuthState;
  plan?: string;              // 'pro' | 'max' | ... (알 수 있을 때만)
  account?: string;           // 표시용
  evidence: string;           // 판별 근거 ("~/.claude/.credentials.json: subscriptionType")
  warnings: string[];         // 예: "ANTHROPIC_API_KEY 환경변수가 설정됨 → API 과금 가능"
  installHint?: string;       // 미설치일 때 설치 명령
  checkedAt: number;
}

// ── 한도 ─────────────────────────────────────────
interface LimitWindow {
  key: '5h' | '7d' | '1d';
  usedPct: number;            // 0–100
  resetsAt?: number;          // unix 초
  used?: number;              // 횟수 기반 한도일 때 (Gemini 일일 요청)
  limit?: number;
}

interface LimitStatus {
  provider: ProviderId;
  windows: LimitWindow[];     // 비어 있으면 "한도 정보 없음"
  source: 'official' | 'estimate' | 'none';
  sourceDetail: string;       // "Claude Code statusline 연동", "오늘 요청 12회 ÷ 1,000회" ...
  updatedAt?: number;
}
```

## IPC

| 명령 / 이벤트 | 입력 | 출력 | 담당 기능 |
| --- | --- | --- | --- |
| `pty_spawn` | `{ profileId, command?, args?, cwd, cols, rows, envRemove[] }`, `onData: Channel<Uint8Array>` | `paneId` | M0-02 |
| `pty_write` | `{ paneId, data }` | – | M0-02 |
| `pty_resize` | `{ paneId, cols, rows }` | – | M0-02 |
| `pty_kill` | `{ paneId }` | – | M0-02 |
| 이벤트 `pty://exit` | – | `{ paneId, code }` | M0-02 |
| `shells_detect` | – | `ShellProfile[]` | M1-06 |
| `providers_detect` | – | `ProviderStatus[]` | M2-01 |
| 이벤트 `providers://changed` | – | `ProviderStatus[]` | M2-01 |
| `limits_get` | `{ force?: boolean }` | `LimitStatus[]` | M2-03, M2-04 |
| 이벤트 `limits://changed` | – | `LimitStatus[]` | M2-03 |
| `claude_bridge_status` / `_connect` / `_disconnect` | – | 연결 상태 / 연결 / 원래 설정으로 복구 | M2-03 |
| `state_load` / `state_save` | `AppState` | `AppState` | M3-01 |
| `settings_load` / `settings_save` | `Settings` | `Settings` | M3-02 |

## 보안 경계

- 인증 파일(`~/.claude/.credentials.json`, `~/.gemini/oauth_creds.json`, `~/.codex/auth.json` 등)은 **Rust에서만 읽기 전용**으로 열고, 허용된 메타데이터 필드만 꺼낸다.
- 토큰 값(access / refresh / id token)은 **IPC를 넘지 않고, 로그에 남기지 않고, 저장하지 않는다.**
- 구독 토큰으로 비공개 API를 호출하지 않는다. 한도는 각 CLI가 공식으로 내주는 데이터만 쓴다.
- 사용자 설정 파일(예: `~/.claude/settings.json`)을 바꿀 때는 **사용자 확인 → 백업 → 변경** 순서를 지키고, 되돌리기 기능을 같이 만든다.

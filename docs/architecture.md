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
 ├─ limits    : 한도 읽기 (Claude 브리지 파일, Antigravity `agy /usage`)
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
│  ├─ main.tsx
│  ├─ app/                  # App, theme.ts(테마 모드), theme.css(색 토큰), app.css
│  ├─ components/           # TitleBar 등 공용 UI
│  ├─ store/                # types · tree(트리 순수 함수) · ops(상태 연산) · store(zustand)
│  └─ features/{terminal,layout,keys,sessions,providers,limits,settings}/   # 기능 구현 시 추가
├─ eslint.config.js  .prettierrc.json  tsconfig*.json  vite.config.ts   # vitest 설정도 vite.config.ts
└─ src-tauri/
   └─ src/{main.rs, lib.rs, pty.rs, shells.rs, store.rs, bridge.rs,
           providers/{mod,claude,codex,antigravity}.rs,
           limits/{mod,claude,antigravity}.rs}
```

## 저장 위치

| 경로 | 내용 | 담당 기능 |
| --- | --- | --- |
| `%APPDATA%\LaDock\state.json` | 세션 · 탭 · 분할 트리 · pane 스펙 | M3-01 |
| `%APPDATA%\LaDock\settings.json` | 설정 | M3-02 |
| `%APPDATA%\LaDock\tasks.json` | 자동 작업 목록 · 예약 · 마지막 실행 시각 | M6-01 |
| `%APPDATA%\LaDock\task-history.json` | 자동 작업 실행 기록 (`RunRecord[]`, 최근 200건) | M6-03 |
| `%APPDATA%\LaDock\task-logs\<runId>.log` | 실행 한 번의 출력 로그 | M6-03 |
| `%APPDATA%\LaDock\panes\` | pane 화면 공유: `index.json` + `<순번>.txt` (앱을 켤 때 비움) | M7-01 |
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
  no?: number;                // 화면에 보이는 pane 순번 (앱 전체 유일, 닫으면 빈 번호 재사용) — M7-01
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
type ProviderId = 'claude' | 'codex' | 'antigravity';
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
  used?: number;              // 횟수 기반 한도일 때
  limit?: number;
  group?: string;          // 모델 묶음별 한도 (Antigravity: "Gemini Models" 등)
}

interface LimitStatus {
  provider: ProviderId;
  windows: LimitWindow[];     // 비어 있으면 "한도 정보 없음"
  source: 'official' | 'estimate' | 'none';
  sourceDetail: string;       // "Claude Code statusline 연동", "오늘 요청 12회 ÷ 1,000회" ...
  updatedAt?: number;
}
```

// ── 자동 작업 ────────────────────────────────────
type TaskKind =
  | { type: 'command'; line: string }                       // 셸에 입력할 한 줄
  | { type: 'script'; path: string; args: string }          // 파일 경로 + 인자
  | { type: 'ai'; provider: ProviderId; prompt: string };   // 프롬프트를 위치 인자로

type Schedule =
  | { type: 'none' }
  | { type: 'daily'; time: string; days: number[] }         // "HH:MM", 요일 0(일)–6(토), 빈 배열이면 매일
  | { type: 'interval'; minutes: number };                  // 1 이상

interface Task {
  id: string;
  name: string;
  kind: TaskKind;
  profileId: string;          // command · script를 돌릴 셸 (pwsh · powershell · cmd · bash)
  cwd: string;                // 빈 값이면 포커스 pane의 현재 폴더
  schedule: Schedule;
  enabled: boolean;           // 예약을 켰는지 (수동 실행은 항상 가능)
  lastRunAt?: number;         // unix 초
}

// 자동 작업은 pane이 아니라 **백그라운드 프로세스**(창 없음, stdout+stderr를 로그 파일로)로 실행한다.
type RunStatus = 'running' | 'ok' | 'failed' | 'stopped' | 'error';

interface RunRecord {
  id: string;                 // 로그 파일 이름 (task-logs/<id>.log)
  taskId: string;
  taskName: string;           // 작업을 지워도 기록은 남도록 이름을 복사해 둔다
  kind: 'command' | 'script' | 'ai';
  trigger: 'manual' | 'schedule';
  summary: string;            // 실행한 내용 (표시용: 명령 한 줄 / 스크립트 / AI 프롬프트 앞부분)
  startedAt: number;          // unix 초
  endedAt?: number;
  status: RunStatus;          // 'error' = 시작 실패 · 앱 종료로 중단
  exitCode?: number;
  error?: string;
}

## IPC

| 명령 / 이벤트 | 입력 | 출력 | 담당 기능 |
| --- | --- | --- | --- |
| `pty_spawn` | `{ profileId, command?, args?, cwd, cols, rows, envRemove[] }`, `onData: Channel<Uint8Array>` | `paneId` | M0-02 |
| `pty_write` | `{ paneId, data }` | – | M0-02 |
| `pty_resize` | `{ paneId, cols, rows }` | – | M0-02 |
| `pty_kill` | `{ paneId }` | – | M0-02 |
| `pty_ack` | `{ paneId, bytes }` — xterm이 처리 끝낸 바이트 수 (흐름 제어, 미확인 1MB 상한) | – | M0-02 |
| 이벤트 `pty://exit` | – | `{ paneId, code }` | M0-02 |
| `shells_detect` | – | `ShellProfile[]` | M1-06 |
| `providers_detect` | – | `ProviderStatus[]` | M2-01 |
| 이벤트 `providers://changed` | – | `ProviderStatus[]` | M2-01 |
| `limits_get` | `{ force?: boolean }` — `force`면 Antigravity를 지금 다시 읽음(약 5초), 아니면 캐시 + 낡았을 때 백그라운드 갱신 | `LimitStatus[]` | M2-03, M2-04 |
| 이벤트 `limits://changed` | – | `LimitStatus[]` | M2-03 |
| 이벤트 `claude-bridge://changed` | – | `{ state, detail, original? }` — 시작 때 `stale`일 때만 | M2-03 |
| `claude_bridge_status` / `_connect` / `_disconnect` | `_connect`는 `{ confirm: true }` 필수 | `{ state: connected｜disconnected｜stale｜unavailable, detail, original? }` | M2-03 |
| `state_load` | – | 저장 파일 원문 `string｜null` (검증 · 마이그레이션은 프론트) | M3-01 |
| `state_save` | `{ json }` — `{ version, state: AppState }` 직렬화, 임시 파일 후 교체 | – | M3-01 |
| `state_quarantine` | – | 읽을 수 없는 `state.json`을 `state.corrupt-<초>.json`으로 옮기고 그 경로 | M3-01 |
| `dirs_exist` | `{ paths[] }` | `bool[]` | M3-01 |
| `settings_load` | – | 저장 파일 원문 `string｜null` (검증 · 기본값 채우기는 프론트 `parseSettings`) | M3-02 |
| `settings_save` | `{ json }` — `Settings` 직렬화, 임시 파일 후 교체 | – | M3-02 |
| `tasks_load` | – | 저장 파일 원문 `string｜null` (검증은 프론트 `parseTasks`) | M6-01 |
| `tasks_save` | `{ json }` — `{ version, tasks: Task[] }` 직렬화, 임시 파일 후 교체 | – | M6-01 |
| `task_run_start` | `{ runId, profileId, command?, args[], cwd?, envRemove? }` — 창 없이 실행, 출력은 `task-logs/<runId>.log`(2MB 상한) | – (시작 실패면 오류) | M6-03 |
| `task_run_kill` | `{ runId }` — 프로세스 트리 종료 | – | M6-03 |
| 이벤트 `task://exit` | – | `{ runId, code?, killed }` | M6-03 |
| `task_log_read` | `{ runId }` | 로그 전문 `string` (없으면 빈 문자열) | M6-03 |
| `task_log_delete` | `{ runIds[] }` | – | M6-03 |
| `task_history_load` / `task_history_save` | `{ json }` — `{ version, runs: RunRecord[] }` (최근 200건) | 원문 `string｜null` | M6-03 |
| `pane_dump` | `{ no, text }` — pane 화면 텍스트를 `%APPDATA%\LaDock\panes\<no>.txt`에 쓴다 | – | M7-01 |
| `panes_index` | `{ json, nos[] }` — `panes\index.json`을 쓰고 목록에 없는 `<no>.txt`를 지운다 | – | M7-01 |
| `skills_install` | – — 설치된 AI 플랫폼에 `ladock-panes` 스킬을 설치 · 갱신 (앱 시작 때도 자동) | `{ platform, path, state, detail? }[]` | M7-01 |
| `pty_spawn` 추가 인자 | `paneNo?` → 자식 환경변수 `LADOCK_PANE`, `LADOCK_PANES_DIR` | | M7-01 |
| `remote_status` | – | `{ enabled, running, url?, error?, clients }` — `url`은 토큰 포함 접속 주소 | M5-01 |
| `remote_set_enabled` | `{ enabled }` — Tailscale IP에 서버를 열거나 닫는다 | `RemoteStatus` | M5-01 |
| `remote_set_https` | `{ enabled }` — `tailscale serve --bg --https=8443`로 HTTPS 주소를 열거나 닫는다 (기본 켬) | `RemoteStatus` (`httpsUrl` 추가) | M5-01 |
| `remote_regenerate_token` | – — 연결된 폰을 끊고 이전 주소를 무효화 | `RemoteStatus` | M5-01 |
| `remote_set_layout` | `{ json }` — 세션 · 탭 · pane 목록(+ PTY id), 폰에 전달 | – | M5-01 |

## 보안 경계

- 인증 파일(`~/.claude/.credentials.json`, `~/.codex/auth.json` 등)은 **Rust에서만 읽기 전용**으로 열고, 허용된 메타데이터 필드만 꺼낸다.
- 토큰 값(access / refresh / id token)은 **IPC를 넘지 않고, 로그에 남기지 않고, 저장하지 않는다.**
- 구독 토큰으로 비공개 API를 호출하지 않는다. 한도는 각 CLI가 공식으로 내주는 데이터만 쓴다.
- 사용자 설정 파일(예: `~/.claude/settings.json`)을 바꿀 때는 **사용자 확인 → 백업 → 변경** 순서를 지키고, 되돌리기 기능을 같이 만든다.

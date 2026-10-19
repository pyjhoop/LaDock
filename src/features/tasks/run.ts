import { invoke } from '@tauri-apps/api/core';
import { uid } from '../../store/ops';
import { buildAgentHeadless, inheritedCwd } from '../ai/providers';
import { isDue } from './schedule';
import { useRuns, type RunRecord } from './runs';
import { isTaskEmpty, useTasks, type Task } from './tasks';

type ShellFamily = 'pwsh' | 'cmd' | 'bash';

/** 작업을 돌릴 수 있는 셸 계열. WSL 등은 아직 지원하지 않는다. */
export function shellFamily(profileId: string): ShellFamily | null {
  if (profileId === 'pwsh' || profileId === 'powershell') return 'pwsh';
  if (profileId === 'cmd') return 'cmd';
  if (profileId === 'bash') return 'bash';
  return null;
}

/** 셸 계열에 맞는 문자열 인용 */
export function quote(family: ShellFamily, s: string): string {
  if (family === 'pwsh') return `'${s.replace(/'/g, "''")}'`;
  if (family === 'cmd') return `"${s.replace(/"/g, '')}"`;
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

const INTERPRETER: Record<string, string> = { py: 'python', js: 'node', sh: 'bash' };

/** 스크립트 파일을 실행하는 한 줄. 확장자로 인터프리터를 고르고, 나머지는 파일을 직접 실행한다. */
export function scriptLine(family: ShellFamily, path: string, args: string): string {
  const ext = /\.([^.\\/]+)$/.exec(path.trim())?.[1]?.toLowerCase() ?? '';
  const target = quote(family, path.trim());
  const tail = args.trim() ? ` ${args.trim()}` : '';
  const interp = INTERPRETER[ext];
  if (interp) return `${interp} ${target}${tail}`;
  if (family === 'pwsh') return `& ${target}${tail}`;
  if (family === 'cmd') return `call ${target}${tail}`;
  return `${target}${tail}`;
}

/** 마지막 네이티브 명령의 종료 코드를 그대로 돌려주고, cmdlet 실패는 1로 (-Command 기본은 항상 0 또는 1) */
const PWSH_EXIT =
  '; $__ok = $?; if ($LASTEXITCODE) { exit $LASTEXITCODE }; if (-not $__ok) { exit 1 }';

/**
 * 창 없이 한 줄을 실행하는 셸 인자. 파이프로 받는 출력이 한글로 깨지지 않도록
 * PowerShell은 출력 인코딩을, cmd는 코드 페이지를 UTF-8로 맞춘다.
 */
export function shellArgs(family: ShellFamily, line: string): string[] {
  if (family === 'pwsh') {
    return [
      '-NoLogo',
      '-NonInteractive',
      '-Command',
      `[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; ${line}${PWSH_EXIT}`,
    ];
  }
  if (family === 'cmd') return ['/d', '/c', `chcp 65001>nul & ${line}`];
  return ['-c', line];
}

export interface RunSpec {
  profileId: string;
  command?: string;
  args: string[];
  cwd: string;
  envRemove?: string[];
  /** 기록에 남길 실행 내용 */
  summary: string;
}

const SUMMARY_MAX = 200;
const clip = (s: string) => (s.length > SUMMARY_MAX ? `${s.slice(0, SUMMARY_MAX)}…` : s);

/** 작업 → 실행 명세. 실행할 수 없으면 사용자에게 보여줄 안내 문장. */
export function buildRunSpec(task: Task): RunSpec | string {
  if (isTaskEmpty(task)) return `"${task.name}" — 실행할 내용이 비어 있습니다`;
  const cwd = task.cwd.trim() || inheritedCwd();
  const k = task.kind;
  if (k.type === 'ai') {
    const cmd = buildAgentHeadless(k.provider, k.prompt.trim());
    if (typeof cmd === 'string') return cmd;
    return {
      profileId: task.profileId,
      command: cmd.command,
      args: cmd.args,
      cwd,
      envRemove: cmd.envRemove,
      summary: clip(k.prompt.trim()),
    };
  }
  const family = shellFamily(task.profileId);
  if (!family) return `"${task.name}" — ${task.profileId} 셸은 아직 지원하지 않습니다`;
  const line = k.type === 'command' ? k.line.trim() : scriptLine(family, k.path, k.args);
  return {
    profileId: task.profileId,
    args: shellArgs(family, line),
    cwd,
    summary: clip(line),
  };
}

/**
 * 작업을 백그라운드로 실행한다. 시작 실패도 기록으로 남기고, 사용자에게 보여줄 안내 문장을 돌려준다.
 * 성공하면 null — 끝나는 건 `task://exit` 이벤트가 기록에 반영한다.
 */
export async function startRun(task: Task, trigger: RunRecord['trigger']): Promise<string | null> {
  const spec = buildRunSpec(task);
  const now = Math.floor(Date.now() / 1000);
  // 실패해도 lastRunAt을 남겨서 예약이 20초마다 같은 오류로 반복 시도하지 않게 한다
  useTasks.getState().markRun(task.id, now);
  if (typeof spec === 'string') return spec;

  const id = uid('r');
  const base = {
    id,
    taskId: task.id,
    taskName: task.name,
    kind: task.kind.type,
    trigger,
    summary: spec.summary,
    startedAt: now,
  } as const;
  useRuns.getState().add({ ...base, status: 'running' });
  try {
    await invoke('task_run_start', {
      args: {
        runId: id,
        profileId: spec.profileId,
        command: spec.command,
        args: spec.args,
        cwd: spec.cwd || undefined,
        envRemove: spec.envRemove,
      },
    });
    return null;
  } catch (e) {
    const error = String(e);
    useRuns.getState().finish(id, { status: 'error', error, endedAt: now });
    return error;
  }
}

export function stopRun(runId: string): void {
  void invoke('task_run_kill', { runId }).catch((e) => console.error('task_run_kill 실패', e));
}

export const isRunning = (taskId: string) =>
  useRuns.getState().runs.some((r) => r.taskId === taskId && r.status === 'running');

const TICK_MS = 20_000;

/** 작업 로드가 끝난 뒤에 켠다. 해제 함수를 돌려준다. */
export function startScheduler(): () => void {
  const startedAt = Math.floor(Date.now() / 1000);
  const tick = () => {
    const { tasks, loaded } = useTasks.getState();
    if (!loaded) return;
    const now = new Date();
    for (const t of tasks) {
      // 이전 실행이 아직 끝나지 않았으면 겹쳐 돌리지 않고 다음 틱에 다시 본다
      if (isDue(t, now, startedAt) && !isRunning(t.id)) void startRun(t, 'schedule');
    }
  };
  const id = setInterval(tick, TICK_MS);
  return () => clearInterval(id);
}

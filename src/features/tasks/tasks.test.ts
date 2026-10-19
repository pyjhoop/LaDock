import { describe, expect, it } from 'vitest';
import { quote, scriptLine, shellArgs, shellFamily } from './run';
import { overflow, parseRuns, statusOnExit, type RunRecord } from './runs';
import { formatDuration, stripAnsi } from './logText';
import { describeSchedule, isDue, lastOccurrence, nextRun } from './schedule';
import { newTask, parseTasks, type Schedule, type Task } from './tasks';

type Daily = Extract<Schedule, { type: 'daily' }>;

// 2026-10-19는 월요일(1)
const at = (h: number, m: number, day = 19) => new Date(2026, 9, day, h, m, 0);
const sec = (d: Date) => d.getTime() / 1000;

function task(patch: Partial<Task>): Task {
  return { ...newTask('pwsh'), enabled: true, ...patch };
}

describe('isDue — daily', () => {
  const daily = (time: string, days: number[] = [], lastRunAt?: number) =>
    task({ schedule: { type: 'daily', time, days }, lastRunAt });

  it('예정 시각이 되면 실행', () => {
    expect(isDue(daily('09:00'), at(9, 0), 0)).toBe(true);
    expect(isDue(daily('09:00'), at(9, 4), 0)).toBe(true);
  });
  it('예정 전이거나 유예(5분)를 넘기면 실행하지 않음', () => {
    expect(isDue(daily('09:00'), at(8, 59), 0)).toBe(false);
    expect(isDue(daily('09:00'), at(9, 6), 0)).toBe(false);
  });
  it('이미 그 시각 이후에 실행했으면 중복 실행하지 않음', () => {
    expect(isDue(daily('09:00', [], sec(at(9, 0))), at(9, 2), 0)).toBe(false);
    expect(isDue(daily('09:00', [], sec(at(9, 0, 18))), at(9, 2), 0)).toBe(true);
  });
  it('요일이 맞지 않으면 실행하지 않음', () => {
    expect(isDue(daily('09:00', [2, 3]), at(9, 1), 0)).toBe(false); // 월요일
    expect(isDue(daily('09:00', [1]), at(9, 1), 0)).toBe(true);
  });
  it('예약이 꺼져 있으면 실행하지 않음', () => {
    expect(isDue({ ...daily('09:00'), enabled: false }, at(9, 0), 0)).toBe(false);
  });
});

describe('isDue — interval / none', () => {
  const every = (minutes: number, lastRunAt?: number) =>
    task({ schedule: { type: 'interval', minutes }, lastRunAt });

  it('마지막 실행(없으면 앱 시작) 후 N분이 지나면 실행', () => {
    const start = sec(at(10, 0));
    expect(isDue(every(30), at(10, 29), start)).toBe(false);
    expect(isDue(every(30), at(10, 30), start)).toBe(true);
    expect(isDue(every(30, sec(at(10, 20))), at(10, 49), start)).toBe(false);
    expect(isDue(every(30, sec(at(10, 20))), at(10, 50), start)).toBe(true);
  });
  it('수동 작업은 실행하지 않음', () => {
    expect(isDue(task({ schedule: { type: 'none' } }), at(9, 0), 0)).toBe(false);
  });
});

describe('nextRun · describeSchedule', () => {
  it('daily 다음 시각은 오늘 남았으면 오늘, 아니면 다음 해당 요일', () => {
    const s: Daily = { type: 'daily', time: '09:00', days: [] };
    expect(nextRun(task({ schedule: s }), at(8, 0), 0)).toBe(sec(at(9, 0)));
    expect(nextRun(task({ schedule: s }), at(10, 0), 0)).toBe(sec(at(9, 0, 20)));
    const wed: Daily = { type: 'daily', time: '09:00', days: [3] };
    expect(nextRun(task({ schedule: wed }), at(10, 0), 0)).toBe(sec(at(9, 0, 21)));
  });
  it('lastOccurrence는 요일에 맞는 가장 최근 시각', () => {
    const s: Daily = { type: 'daily', time: '09:00', days: [5] }; // 금요일
    expect(lastOccurrence(s, at(10, 0))).toBe(sec(at(9, 0, 16)));
  });
  it('설명 문구', () => {
    expect(describeSchedule({ type: 'none' })).toBe('수동');
    expect(describeSchedule({ type: 'interval', minutes: 15 })).toBe('15분마다');
    expect(describeSchedule({ type: 'daily', time: '08:30', days: [] })).toBe('매일 08:30');
    expect(describeSchedule({ type: 'daily', time: '08:30', days: [1, 3] })).toBe('월·수 08:30');
  });
});

describe('셸 명령 만들기', () => {
  it('셸 계열 판별', () => {
    expect(shellFamily('pwsh')).toBe('pwsh');
    expect(shellFamily('powershell')).toBe('pwsh');
    expect(shellFamily('cmd')).toBe('cmd');
    expect(shellFamily('wsl:Ubuntu')).toBeNull();
  });
  it('인용', () => {
    expect(quote('pwsh', "it's")).toBe("'it''s'");
    expect(quote('cmd', 'a "b"')).toBe('"a b"');
    expect(quote('bash', "it's")).toBe("'it'\\''s'");
  });
  it('스크립트: 확장자로 인터프리터를 고른다', () => {
    expect(scriptLine('pwsh', 'C:\\s\\a.ps1', '-x 1')).toBe("& 'C:\\s\\a.ps1' -x 1");
    expect(scriptLine('pwsh', 'C:\\s\\a.py', '')).toBe("python 'C:\\s\\a.py'");
    expect(scriptLine('cmd', 'C:\\s\\a.bat', '')).toBe('call "C:\\s\\a.bat"');
    expect(scriptLine('bash', '/x/a.sh', 'v')).toBe("bash '/x/a.sh' v");
  });
  it('창 없이 한 줄을 실행하고 UTF-8 출력으로 맞춘다', () => {
    const ps = shellArgs('pwsh', 'dir');
    expect(ps.slice(0, 3)).toEqual(['-NoLogo', '-NonInteractive', '-Command']);
    expect(ps[3]).toContain('OutputEncoding');
    expect(ps[3]).toContain('; dir; $__ok = $?;');
    expect(ps[3]).toContain('exit $LASTEXITCODE');
    expect(shellArgs('cmd', 'dir')).toEqual(['/d', '/c', 'chcp 65001>nul & dir']);
    expect(shellArgs('bash', 'ls')).toEqual(['-c', 'ls']);
  });
});

describe('parseTasks', () => {
  it('파일이 없거나 깨지면 빈 목록', () => {
    expect(parseTasks(null)).toEqual([]);
    expect(parseTasks('{깨짐')).toEqual([]);
    expect(parseTasks('{"tasks":3}')).toEqual([]);
  });
  it('잘못된 항목은 버리고 값은 보정한다', () => {
    const raw = JSON.stringify({
      version: 1,
      tasks: [
        {
          id: 'a',
          name: ' ',
          kind: { type: 'command', line: 'dir' },
          schedule: { type: 'interval', minutes: 0 },
        },
        { id: 'a', kind: { type: 'command', line: 'dup' } },
        { id: 'b', kind: { type: 'nope' } },
        {
          id: 'c',
          kind: { type: 'ai', provider: 'claude', prompt: 'hi' },
          schedule: { type: 'daily', time: '25:00' },
        },
      ],
    });
    const tasks = parseTasks(raw);
    expect(tasks.map((t) => t.id)).toEqual(['a', 'c']);
    expect(tasks[0].name).toBe('이름 없는 작업');
    expect(tasks[0].schedule).toEqual({ type: 'interval', minutes: 1 });
    expect(tasks[0].enabled).toBe(false);
    expect(tasks[1].schedule).toEqual({ type: 'none' });
  });
});

function run(id: string, patch: Partial<RunRecord> = {}): RunRecord {
  return {
    id,
    taskId: 't',
    taskName: '작업',
    kind: 'command',
    trigger: 'manual',
    summary: 'dir',
    startedAt: 100,
    status: 'ok',
    ...patch,
  };
}

describe('실행 기록', () => {
  it('종료 이벤트 → 상태', () => {
    expect(statusOnExit(0, false)).toBe('ok');
    expect(statusOnExit(1, false)).toBe('failed');
    expect(statusOnExit(undefined, false)).toBe('failed');
    expect(statusOnExit(1, true)).toBe('stopped');
  });
  it('파일이 없거나 깨지면 빈 목록, 잘못된 항목은 버리고 최신순으로 정렬', () => {
    expect(parseRuns(null)).toEqual([]);
    expect(parseRuns('{깨짐')).toEqual([]);
    const raw = JSON.stringify({
      version: 1,
      runs: [
        run('a', { startedAt: 10 }),
        run('b', { startedAt: 30 }),
        run('a', { startedAt: 99 }), // 중복 id
        { id: 'x', status: 'nope', startedAt: 1 },
        { id: 'y', status: 'ok' }, // startedAt 없음
      ],
    });
    expect(parseRuns(raw).map((r) => r.id)).toEqual(['b', 'a']);
  });
  it('저장 당시 실행 중이던 기록은 중단된 것으로 바꾼다', () => {
    const [r] = parseRuns(JSON.stringify({ runs: [run('a', { status: 'running' })] }));
    expect(r.status).toBe('error');
    expect(r.error).toContain('중단');
  });
  it('상한을 넘으면 가장 오래된, 실행 중이 아닌 기록부터 고른다', () => {
    const runs = [
      run('new', { startedAt: 4 }),
      run('mid', { startedAt: 3 }),
      run('live', { startedAt: 2, status: 'running' }),
      run('old', { startedAt: 1 }),
    ];
    expect(overflow(runs, 4)).toEqual([]);
    expect(overflow(runs, 3).map((r) => r.id)).toEqual(['old']);
    expect(overflow(runs, 2).map((r) => r.id)).toEqual(['old', 'mid']);
  });
});

describe('로그 보기', () => {
  it('ANSI 색상 · 제어 시퀀스를 지운다', () => {
    expect(stripAnsi('[31m빨강[0m 보통')).toBe('빨강 보통');
    expect(stripAnsi('a]0;제목b')).toBe('ab');
  });
  it('소요 시간 표시', () => {
    expect(formatDuration(5)).toBe('5초');
    expect(formatDuration(125)).toBe('2분 5초');
    expect(formatDuration(3720)).toBe('1시간 2분');
  });
});

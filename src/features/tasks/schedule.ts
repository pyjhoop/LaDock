import type { Schedule, Task } from './tasks';

/** 놓친 daily 예약을 이 시간 안에서만 따라잡는다 (앱이 꺼져 있던 동안의 예약은 보충하지 않음) */
export const GRACE_SEC = 5 * 60;
export const DAY_LABELS = ['일', '월', '화', '수', '목', '금', '토'] as const;

/** 오늘 `HH:MM`을 unix 초로. day 오프셋 만큼 이전/이후 날짜. */
function at(now: Date, time: string, dayOffset: number): number {
  const [h, m] = time.split(':').map(Number);
  return (
    new Date(now.getFullYear(), now.getMonth(), now.getDate() + dayOffset, h, m, 0).getTime() / 1000
  );
}

/** now 이전(같거나 이른) 가장 최근 daily 예정 시각. 최근 7일 안에 요일이 맞는 날이 없으면 null. */
export function lastOccurrence(s: Extract<Schedule, { type: 'daily' }>, now: Date): number | null {
  const nowSec = now.getTime() / 1000;
  for (let back = 0; back <= 7; back++) {
    const t = at(now, s.time, -back);
    const day = new Date(t * 1000).getDay();
    if (t <= nowSec && (s.days.length === 0 || s.days.includes(day))) return t;
  }
  return null;
}

/** now 이후 가장 가까운 daily 예정 시각. */
function nextOccurrence(s: Extract<Schedule, { type: 'daily' }>, now: Date): number | null {
  const nowSec = now.getTime() / 1000;
  for (let ahead = 0; ahead <= 7; ahead++) {
    const t = at(now, s.time, ahead);
    const day = new Date(t * 1000).getDay();
    if (t > nowSec && (s.days.length === 0 || s.days.includes(day))) return t;
  }
  return null;
}

/**
 * 지금 실행할 때가 됐는지. `startedAt`은 앱을 켠 시각(unix 초) — interval의 기준점이 된다.
 */
export function isDue(task: Task, now: Date, startedAt: number): boolean {
  if (!task.enabled) return false;
  const nowSec = now.getTime() / 1000;
  const s = task.schedule;
  if (s.type === 'interval') {
    return nowSec - (task.lastRunAt ?? startedAt) >= s.minutes * 60;
  }
  if (s.type === 'daily') {
    const occ = lastOccurrence(s, now);
    if (occ === null || nowSec - occ > GRACE_SEC) return false;
    return (task.lastRunAt ?? 0) < occ;
  }
  return false;
}

/** 다음 실행 예정 시각(unix 초). 예약이 꺼져 있거나 수동이면 null. */
export function nextRun(task: Task, now: Date, startedAt: number): number | null {
  if (!task.enabled) return null;
  const s = task.schedule;
  if (s.type === 'interval') return (task.lastRunAt ?? startedAt) + s.minutes * 60;
  if (s.type === 'daily') return nextOccurrence(s, now);
  return null;
}

export function describeSchedule(s: Schedule): string {
  if (s.type === 'interval') return `${s.minutes}분마다`;
  if (s.type === 'daily') {
    const days =
      s.days.length === 0 || s.days.length === 7
        ? '매일'
        : s.days.map((d) => DAY_LABELS[d]).join('·');
    return `${days} ${s.time}`;
  }
  return '수동';
}

export function formatTime(sec: number): string {
  const d = new Date(sec * 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

import { useState } from 'react';
import { useKeys } from '../keys/keys';
import { startRun, stopRun } from './run';
import { latestRunOf, useRuns, type RunStatus } from './runs';
import { describeSchedule } from './schedule';
import { useTasks } from './tasks';
import './tasks.css';

const KIND_SHORT = { command: '명령', script: '스크립트', ai: 'AI' } as const;
export const STATUS_LABEL: Record<RunStatus, string> = {
  running: '실행 중',
  ok: '성공',
  failed: '실패',
  stopped: '중지됨',
  error: '오류',
};
export const STATUS_GLYPH: Record<RunStatus, string> = {
  running: '◌',
  ok: '✓',
  failed: '✗',
  stopped: '■',
  error: '!',
};

/** 사이드바 "자동 작업" 절: 작업 목록 · ▶ 백그라운드 실행 · 클릭하면 편집 · + 등록 · 기록 페이지 */
export function TasksSection() {
  const tasks = useTasks((s) => s.tasks);
  const runs = useRuns((s) => s.runs);
  const [folded, setFolded] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const keys = useKeys.getState();

  return (
    <section className="sb-sec">
      <div className="sec-head">
        <button className="sec-toggle" onClick={() => setFolded(!folded)} aria-expanded={!folded}>
          <span className={`chev${folded ? '' : ' open'}`}>▸</span>
          <h3>자동 작업</h3>
          <span className="count">{tasks.length}</span>
        </button>
        <button
          className="icon-btn"
          onClick={() => keys.openOverlay({ kind: 'taskLog' })}
          title="실행 기록"
          aria-label="실행 기록"
        >
          ☰
        </button>
        <button
          className="icon-btn"
          onClick={() => keys.openOverlay({ kind: 'taskEdit', id: null })}
          title="작업 등록"
          aria-label="작업 등록"
        >
          +
        </button>
      </div>
      {!folded && (
        <div className="cards">
          {tasks.length === 0 && <p className="agent-empty">등록된 작업이 없습니다</p>}
          {tasks.map((t) => {
            const last = latestRunOf(runs, t.id);
            const running = last?.status === 'running';
            return (
              <div key={t.id} className="card task-card">
                <button
                  className="task-run"
                  title={running ? '중지' : '백그라운드로 실행'}
                  aria-label={`${t.name} ${running ? '중지' : '실행'}`}
                  onClick={() => {
                    if (running && last) return stopRun(last.id);
                    void startRun(t, 'manual').then(setMsg);
                  }}
                >
                  {running ? '■' : '▶'}
                </button>
                <button
                  className="task-info"
                  title="편집"
                  onClick={() => keys.openOverlay({ kind: 'taskEdit', id: t.id })}
                >
                  <span className="name">{t.name}</span>
                  <span className="meta">
                    {KIND_SHORT[t.kind.type]} · {describeSchedule(t.schedule)}
                    {t.schedule.type !== 'none' && !t.enabled && ' (꺼짐)'}
                  </span>
                </button>
                {last && (
                  <button
                    className={`task-state ${last.status}`}
                    title={`${STATUS_LABEL[last.status]} — 기록 보기`}
                    aria-label={`${t.name} 마지막 실행: ${STATUS_LABEL[last.status]}`}
                    onClick={() => keys.openOverlay({ kind: 'taskLog' })}
                  >
                    {STATUS_GLYPH[last.status]}
                  </button>
                )}
              </div>
            );
          })}
          {msg && <p className="agent-empty task-err">{msg}</p>}
        </div>
      )}
    </section>
  );
}

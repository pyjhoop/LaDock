import { invoke } from '@tauri-apps/api/core';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useKeys } from '../keys/keys';
import { startRun, stopRun } from './run';
import { useRuns, type RunRecord } from './runs';
import { formatDuration, stripAnsi } from './logText';
import { formatTime } from './schedule';
import { STATUS_GLYPH, STATUS_LABEL } from './TasksSection';
import { useTasks } from './tasks';
import './tasks.css';

const KIND_SHORT = { command: '명령', script: '스크립트', ai: 'AI' } as const;
const TRIGGER_LABEL = { manual: '수동', schedule: '예약' } as const;
const POLL_MS = 1000;

const duration = (r: RunRecord) =>
  formatDuration(Math.max(0, (r.endedAt ?? Math.floor(Date.now() / 1000)) - r.startedAt));

/** 실행 기록 + 로그 뷰어. 설정 페이지처럼 작업 영역을 대신해서 보인다 (터미널은 계속 살아 있다). */
export function TaskLogPage() {
  const close = useKeys((s) => s.closeOverlay);
  const runs = useRuns((s) => s.runs);
  const remove = useRuns((s) => s.remove);
  const tasks = useTasks((s) => s.tasks);
  const [filter, setFilter] = useState('all');
  const [picked, setPicked] = useState<string | null>(null);
  const [log, setLog] = useState<{ id: string; text: string } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const logRef = useRef<HTMLPreElement>(null);

  const visible = useMemo(
    () => (filter === 'all' ? runs : runs.filter((r) => r.taskId === filter)),
    [runs, filter],
  );
  const selected = visible.find((r) => r.id === picked) ?? visible[0];
  const selectedId = selected?.id;
  const selectedStatus = selected?.status;

  useEffect(() => {
    (document.activeElement as HTMLElement | null)?.blur();
    pageRef.current?.focus();
  }, []);

  // 로그 읽기: 실행 중이면 1초마다, 끝났으면 한 번 (상태가 바뀌면 다시)
  useEffect(() => {
    if (!selectedId) return;
    let alive = true;
    const read = () =>
      invoke<string>('task_log_read', { runId: selectedId })
        .then((text) => alive && setLog({ id: selectedId, text: stripAnsi(text) }))
        .catch((e) => alive && setLog({ id: selectedId, text: `로그를 읽지 못했습니다: ${e}` }));
    void read();
    if (selectedStatus !== 'running') return () => void (alive = false);
    const t = setInterval(read, POLL_MS);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [selectedId, selectedStatus]);

  // 실행 중에는 항상 맨 아래(최신 출력)를 따라간다
  useEffect(() => {
    if (selectedStatus === 'running' && logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [log, selectedStatus]);

  const task = selected ? tasks.find((t) => t.id === selected.taskId) : undefined;
  const text = selected && log?.id === selected.id ? log.text : '';
  const finished = runs.filter((r) => r.status !== 'running');

  return (
    <div
      ref={pageRef}
      tabIndex={-1}
      className="settings-page tlog"
      onKeyDown={(e) => {
        const t = e.target;
        if (e.key === 'Escape' && !(t instanceof HTMLSelectElement)) close();
      }}
    >
      <nav className="tlog-side">
        <div className="tlog-head">
          <button type="button" className="settings-back" onClick={close}>
            ← 터미널로
          </button>
          <h2>자동 작업 기록</h2>
        </div>
        <div className="tlog-tools">
          <select value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="all">모든 작업</option>
            {tasks.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="set-btn"
            disabled={finished.length === 0}
            onClick={() =>
              window.confirm(`끝난 기록 ${finished.length}건을 모두 지울까요?`) &&
              remove(finished.map((r) => r.id))
            }
          >
            모두 지우기
          </button>
        </div>
        <ul className="tlog-list">
          {visible.length === 0 && <li className="tlog-empty">실행 기록이 없습니다</li>}
          {visible.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                className={r.id === selectedId ? 'on' : undefined}
                onClick={() => setPicked(r.id)}
              >
                <span className={`tlog-st ${r.status}`} title={STATUS_LABEL[r.status]}>
                  {STATUS_GLYPH[r.status]}
                </span>
                <span className="tlog-name">{r.taskName}</span>
                <span className="tlog-when">{formatTime(r.startedAt)}</span>
              </button>
            </li>
          ))}
        </ul>
      </nav>

      <div className="tlog-main">
        {!selected ? (
          <p className="muted tlog-none">
            왼쪽 사이드바의 자동 작업에서 ▶를 누르거나 예약을 켜 두면 여기에 기록이 쌓여요.
          </p>
        ) : (
          <>
            <div className="tlog-info">
              <div className="tlog-title">
                <h2>{selected.taskName}</h2>
                <span className={`tlog-badge ${selected.status}`}>
                  {STATUS_GLYPH[selected.status]} {STATUS_LABEL[selected.status]}
                </span>
              </div>
              <small className="muted">
                {KIND_SHORT[selected.kind]} · {TRIGGER_LABEL[selected.trigger]} 실행 ·{' '}
                {formatTime(selected.startedAt)} 시작 · {duration(selected)}
                {selected.exitCode !== undefined && ` · 종료 코드 ${selected.exitCode}`}
              </small>
              <pre className="tlog-cmd">{selected.summary}</pre>
              {selected.error && <small className="set-warn">{selected.error}</small>}
              <div className="set-line">
                {selected.status === 'running' ? (
                  <button type="button" className="set-btn" onClick={() => stopRun(selected.id)}>
                    ■ 중지
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      className="set-btn"
                      disabled={!task}
                      title={task ? undefined : '삭제된 작업이라 다시 실행할 수 없어요'}
                      onClick={() => task && void startRun(task, 'manual').then(setMsg)}
                    >
                      ▶ 다시 실행
                    </button>
                    <button type="button" className="set-btn" onClick={() => remove([selected.id])}>
                      이 기록 지우기
                    </button>
                  </>
                )}
                <button
                  type="button"
                  className="set-btn"
                  disabled={!text}
                  onClick={() => void navigator.clipboard.writeText(text)}
                >
                  로그 복사
                </button>
              </div>
              {msg && <small className="set-warn">{msg}</small>}
            </div>
            <pre ref={logRef} className="tlog-log">
              {text || (selected.status === 'running' ? '출력을 기다리는 중…' : '(출력 없음)')}
            </pre>
          </>
        )}
      </div>
    </div>
  );
}

import { useEffect, useState, type ReactNode } from 'react';
import { PROVIDER_META } from '../ai/providers';
import { useKeys } from '../keys/keys';
import { useShells } from '../sessions/shells';
import { useSettings } from '../settings/settings';
import { shellFamily } from './run';
import { DAY_LABELS } from './schedule';
import {
  MIN_INTERVAL_MINUTES,
  PROVIDERS,
  isTaskEmpty,
  newTask,
  useTasks,
  type Schedule,
  type Task,
  type TaskKind,
} from './tasks';
import './tasks.css';

const KIND_LABEL = { command: '명령', script: '스크립트', ai: 'AI 프롬프트' } as const;
const SCHEDULE_LABEL = { none: '수동', daily: '매일·요일', interval: 'N분마다' } as const;

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="task-field">
      <span>{label}</span>
      {children}
    </label>
  );
}

function defaultKind(type: TaskKind['type']): TaskKind {
  if (type === 'script') return { type, path: '', args: '' };
  if (type === 'ai') return { type, provider: 'claude', prompt: '' };
  return { type, line: '' };
}

function defaultSchedule(type: Schedule['type']): Schedule {
  if (type === 'daily') return { type, time: '09:00', days: [] };
  if (type === 'interval') return { type, minutes: 60 };
  return { type };
}

function TaskEditor({ initial, onDone }: { initial: Task; onDone: () => void }) {
  const profiles = useShells((s) => s.profiles);
  const [t, setT] = useState(initial);
  const upsert = useTasks((s) => s.upsert);
  const remove = useTasks((s) => s.remove);
  const saved = useTasks((s) => s.tasks.some((x) => x.id === initial.id));
  const k = t.kind;
  const sch = t.schedule;
  const usesShell = k.type !== 'ai';
  const shellOk = !usesShell || shellFamily(t.profileId) !== null;
  const canSave = !isTaskEmpty(t) && shellOk && t.name.trim() !== '';

  return (
    <div className="task-editor">
      <Field label="이름">
        <input autoFocus value={t.name} onChange={(e) => setT({ ...t, name: e.target.value })} />
      </Field>

      <div className="set-seg">
        {(Object.keys(KIND_LABEL) as TaskKind['type'][]).map((type) => (
          <button
            key={type}
            type="button"
            className={type === k.type ? 'on' : undefined}
            onClick={() => type !== k.type && setT({ ...t, kind: defaultKind(type) })}
          >
            {KIND_LABEL[type]}
          </button>
        ))}
      </div>

      {k.type === 'command' && (
        <Field label="실행할 명령 (한 줄)">
          <input
            value={k.line}
            placeholder="예: git pull; pnpm test"
            onChange={(e) => setT({ ...t, kind: { ...k, line: e.target.value } })}
          />
        </Field>
      )}
      {k.type === 'script' && (
        <>
          <Field label="스크립트 파일 경로 (.ps1 .bat .py .js .sh …)">
            <input
              value={k.path}
              placeholder="C:\scripts\backup.ps1"
              onChange={(e) => setT({ ...t, kind: { ...k, path: e.target.value } })}
            />
          </Field>
          <Field label="인자">
            <input
              value={k.args}
              placeholder="없으면 비워두기"
              onChange={(e) => setT({ ...t, kind: { ...k, args: e.target.value } })}
            />
          </Field>
        </>
      )}
      {k.type === 'ai' && (
        <>
          <Field label="AI">
            <select
              value={k.provider}
              onChange={(e) =>
                setT({
                  ...t,
                  kind: { ...k, provider: e.target.value as (typeof PROVIDERS)[number] },
                })
              }
            >
              {PROVIDERS.map((id) => (
                <option key={id} value={id}>
                  {PROVIDER_META[id].name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="프롬프트 (백그라운드에서 한 번 실행하고 결과를 기록에 남김)">
            <textarea
              rows={4}
              value={k.prompt}
              placeholder="예: 오늘 들어온 이슈를 정리해줘"
              onChange={(e) => setT({ ...t, kind: { ...k, prompt: e.target.value } })}
            />
          </Field>
        </>
      )}

      {usesShell && (
        <Field label="셸">
          <select value={t.profileId} onChange={(e) => setT({ ...t, profileId: e.target.value })}>
            {!profiles.some((p) => p.id === t.profileId) && (
              <option value={t.profileId}>{t.profileId} (감지 안 됨)</option>
            )}
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </Field>
      )}
      {!shellOk && (
        <small className="set-warn">이 셸은 아직 지원하지 않아요 (pwsh · cmd · bash)</small>
      )}

      <Field label="작업 폴더 (비우면 지금 보는 pane의 폴더, 예약 실행도 그때 보던 폴더)">
        <input value={t.cwd} onChange={(e) => setT({ ...t, cwd: e.target.value })} />
      </Field>

      <div className="set-seg">
        {(Object.keys(SCHEDULE_LABEL) as Schedule['type'][]).map((type) => (
          <button
            key={type}
            type="button"
            className={type === sch.type ? 'on' : undefined}
            onClick={() =>
              type !== sch.type &&
              setT({ ...t, schedule: defaultSchedule(type), enabled: type !== 'none' })
            }
          >
            {SCHEDULE_LABEL[type]}
          </button>
        ))}
      </div>

      {sch.type === 'daily' && (
        <div className="task-sched">
          <input
            type="time"
            value={sch.time}
            onChange={(e) =>
              e.target.value && setT({ ...t, schedule: { ...sch, time: e.target.value } })
            }
          />
          <div className="task-days">
            {DAY_LABELS.map((label, d) => {
              const on = sch.days.length === 0 || sch.days.includes(d);
              return (
                <button
                  key={label}
                  type="button"
                  className={on ? 'on' : undefined}
                  onClick={() => {
                    // 전부 켜진 상태(빈 배열)에서 누르면 그 요일만 끈다
                    const cur = sch.days.length === 0 ? [0, 1, 2, 3, 4, 5, 6] : sch.days;
                    const next = cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d].sort();
                    if (next.length === 0) return;
                    setT({
                      ...t,
                      schedule: { ...sch, days: next.length === 7 ? [] : next },
                    });
                  }}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>
      )}
      {sch.type === 'interval' && (
        <div className="task-sched">
          <input
            type="number"
            min={MIN_INTERVAL_MINUTES}
            value={sch.minutes}
            onChange={(e) =>
              setT({
                ...t,
                schedule: {
                  ...sch,
                  minutes: Math.max(MIN_INTERVAL_MINUTES, Math.round(Number(e.target.value)) || 1),
                },
              })
            }
          />
          <span>분마다</span>
        </div>
      )}
      {sch.type !== 'none' && (
        <label className="task-check">
          <input
            type="checkbox"
            checked={t.enabled}
            onChange={(e) => setT({ ...t, enabled: e.target.checked })}
          />
          예약 켜기 (앱이 켜져 있는 동안만 실행)
        </label>
      )}

      <div className="set-line">
        <button
          type="button"
          className="set-btn"
          disabled={!canSave}
          onClick={() => {
            upsert({ ...t, name: t.name.trim() });
            onDone();
          }}
        >
          저장
        </button>
        <button type="button" className="set-btn" onClick={onDone}>
          취소
        </button>
        {saved && (
          <button
            type="button"
            className="set-btn task-del"
            onClick={() => {
              if (window.confirm(`"${t.name}" 작업을 삭제할까요?`)) {
                remove(t.id);
                onDone();
              }
            }}
          >
            삭제
          </button>
        )}
      </div>
    </div>
  );
}

/** 사이드바에서 여는 작업 등록 · 편집 팝업. `id`가 null이면 새 작업. */
export function TaskDialog({ id }: { id: string | null }) {
  const close = useKeys((s) => s.closeOverlay);
  const defaultShell = useSettings((s) => s.settings.defaultShell);
  const [initial] = useState(
    () =>
      useTasks.getState().tasks.find((t) => t.id === id) ??
      newTask(shellFamily(defaultShell) ? defaultShell : 'pwsh'),
  );

  useEffect(() => {
    if (useShells.getState().profiles.length === 0) void useShells.getState().load();
    (document.activeElement as HTMLElement | null)?.blur();
  }, []);

  // 입력 중 실수로 닫혀 내용이 날아가지 않도록 바깥 클릭으로는 닫지 않는다 (Esc · 취소로만)
  return (
    <div className="overlay">
      <div
        className="overlay-box task-dialog"
        onKeyDown={(e) => {
          if (e.key === 'Escape' && !e.nativeEvent.isComposing) close();
        }}
      >
        <h2>{id ? '작업 편집' : '새 작업'}</h2>
        <TaskEditor initial={initial} onDone={close} />
      </div>
    </div>
  );
}

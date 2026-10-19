import { Fragment, useEffect, useRef, useState } from 'react';
import {
  PROVIDER_META,
  PROVIDER_ORDER,
  launchAgent,
  useLaunchPrefs,
  useProviders,
  type ProviderStatus,
} from '../ai/providers';
import { PROVIDER_GLYPH } from '../sessions/ui';
import type { ProviderId } from '../../store/types';
import {
  LEVEL_TEXT,
  WINDOW_META,
  formatClock,
  formatReset,
  levelOf,
  mergeGroups,
  roundPct,
  useLimits,
  worstLevel,
  type LimitStatus,
  type LimitWindow,
} from './limits';
import './limits.css';

const CLOSE_DELAY_MS = 180;

const GROUP_LABELS: Record<string, string> = {
  'Gemini Models': 'Gemini 모델',
  'Claude and GPT models': 'Claude · GPT 모델',
};
/** 연달아 같은 묶음인 창끼리 모은다 (묶음이 없으면 이름 없는 하나의 목록). */
function groupsOf(windows: LimitWindow[]): [string | undefined, LimitWindow[]][] {
  const out: [string | undefined, LimitWindow[]][] = [];
  for (const w of windows) {
    const last = out[out.length - 1];
    if (last && last[0] === w.group) last[1].push(w);
    else out.push([w.group, [w]]);
  }
  return out;
}
const groupLabel = (name: string) => GROUP_LABELS[name] ?? name;

type BadgeTone = 'ok' | 'check' | 'none';

function badgeOf(s: ProviderStatus): { tone: BadgeTone; text: string } {
  if (s.auth === 'subscription') {
    const plan = s.plan ? `${s.plan[0].toUpperCase()}${s.plan.slice(1)} ` : '';
    return { tone: 'ok', text: `${plan}구독` };
  }
  if (s.auth === 'api_key') return { tone: 'check', text: 'API 키 · 확인 필요' };
  if (s.auth === 'logged_out') return { tone: 'none', text: '로그아웃' };
  return { tone: 'check', text: '확인 필요' };
}

const ICON_REFRESH = (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
    <path d="M13 8a5 5 0 1 1-1.5-3.6M13 2.5v3h-3" />
  </svg>
);
const ICON_PLAY = (
  <svg viewBox="0 0 16 16" fill="currentColor">
    <path d="M5 3.5v9l7-4.5z" />
  </svg>
);
const ICON_COPY = (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
    <rect x="5" y="5" width="8.5" height="8.5" rx="1.5" />
    <path d="M11 5V3.5A1 1 0 0 0 10 2.5H3.5a1 1 0 0 0-1 1V10a1 1 0 0 0 1 1H5" />
  </svg>
);

/** 팝오버가 열려 있는 동안 30초마다 갱신되는 현재 시각(unix 초) */
function useNowSec(active: boolean): number {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    if (!active) return;
    const tick = () => setNow(Math.floor(Date.now() / 1000));
    const first = setTimeout(tick, 0);
    const id = setInterval(tick, 30_000);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [active]);
  return now;
}

function Gauge({
  id,
  w,
  now,
  compact,
}: {
  id: ProviderId;
  w: LimitWindow;
  now: number;
  compact?: boolean;
}) {
  const meta = WINDOW_META[w.key];
  const pct = roundPct(w.usedPct);
  const lv = levelOf(w.usedPct);
  const sub =
    w.used !== undefined && w.limit !== undefined
      ? `${w.used.toLocaleString()} / ${w.limit.toLocaleString()}회`
      : `남은 ${100 - pct}%`;
  return (
    <div className={`lim lv-${lv}`}>
      <div className="lim-row">
        <span className="lbl">{meta.name}</span>
        <span className="lv">{LEVEL_TEXT[lv]}</span>
        <span className="pct">{pct}%</span>
      </div>
      <div
        className="meter"
        role="meter"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        aria-label={`${PROVIDER_META[id].name} ${meta.name} 한도 사용률`}
      >
        <i style={{ width: `${pct}%` }} />
      </div>
      <div className="lim-sub">
        {!compact && <span>{sub}</span>}
        <span>{formatReset(w.resetsAt, now)}</span>
      </div>
    </div>
  );
}

function ProviderSection({
  id,
  status,
  limit,
  now,
  onLaunch,
  onNotice,
}: {
  id: ProviderId;
  status: ProviderStatus;
  limit: LimitStatus | undefined;
  now: number;
  onLaunch: () => void;
  onNotice: (msg: string | null) => void;
}) {
  const meta = PROVIDER_META[id];
  const g = PROVIDER_GLYPH[id];
  const bridge = useLimits((s) => s.bridge);
  const [confirming, setConfirming] = useState(false);
  const badge = badgeOf(status);
  const needBridge = id === 'claude' && bridge && bridge.state !== 'connected';

  return (
    <section className="u-prov" style={{ ['--pc' as string]: g.color }}>
      <div className="u-top">
        <span className="pglyph sm">{g.glyph}</span>
        <span className="name">{meta.name}</span>
        <span className={`badge ${badge.tone}`}>{badge.text}</span>
        <button className="btn xs" title="오른쪽 분할로 실행" onClick={onLaunch}>
          {ICON_PLAY}실행
        </button>
      </div>
      {status.warnings.map((w) => (
        <p key={w} className="u-warn">
          {w}
        </p>
      ))}
      {limit && limit.windows.length > 0 ? (
        groupsOf(limit.windows).map(([group, ws]) =>
          group ? (
            <Fragment key={group}>
              <div className="lim-group">{groupLabel(group)}</div>
              <div className="lim-pair">
                {ws.map((w) => (
                  <Gauge key={w.key} id={id} w={w} now={now} compact />
                ))}
              </div>
            </Fragment>
          ) : (
            ws.map((w) => <Gauge key={w.key} id={id} w={w} now={now} />)
          ),
        )
      ) : (
        <div className="u-empty">한도 정보 없음</div>
      )}
      {limit && (
        <div className="u-src">
          {limit.windows.length > 0 && (
            <span className={`tag${limit.source === 'estimate' ? ' est' : ''}`}>
              {limit.source === 'estimate' ? '추정' : '공식'}
            </span>
          )}
          <span>
            {limit.sourceDetail}
            {limit.updatedAt !== undefined && ` · ${formatClock(limit.updatedAt)}`}
          </span>
        </div>
      )}
      {needBridge &&
        (confirming ? (
          <div className="u-confirm">
            <p>
              <code>~/.claude/settings.json</code>의 statusLine을 LaDock 브리지로 감쌉니다. 변경
              전에 백업하고, 나중에 원래대로 되돌릴 수 있어요.
            </p>
            <button
              className="btn xs primary"
              onClick={() =>
                void useLimits
                  .getState()
                  .connectBridge()
                  .then((err) => {
                    setConfirming(false);
                    onNotice(err);
                  })
              }
            >
              확인하고 연결
            </button>
            <button className="btn xs" onClick={() => setConfirming(false)}>
              취소
            </button>
          </div>
        ) : (
          <button className="btn xs u-connect" onClick={() => setConfirming(true)}>
            {bridge.state === 'stale' ? '다시 연결하기' : '연결하기'}
            <small>{bridge.detail}</small>
          </button>
        ))}
    </section>
  );
}

function Popover({ show, onLaunched }: { show: boolean; onLaunched: () => void }) {
  const statuses = useProviders((s) => s.statuses);
  const items = useLimits((s) => s.items);
  const refresh = useLimits((s) => s.refresh);
  const subOnly = useLaunchPrefs((s) => s.subscriptionOnly);
  const setSubOnly = useLaunchPrefs((s) => s.setSubscriptionOnly);
  const now = useNowSec(show);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const installed = PROVIDER_ORDER.filter((id) => statuses.find((s) => s.id === id)?.installed);
  const missing = PROVIDER_ORDER.filter((id) => !installed.includes(id));

  return (
    <div className={`usage-pop${show ? ' show' : ''}`} role="dialog" aria-label="AI 한도">
      <div className="u-head">
        <b>AI 한도</b>
        <span className="sub">사용률 · 리셋까지 남은 시간{loading && ' · 확인 중…'}</span>
        <button
          className={`icon-btn${loading ? ' spinning' : ''}`}
          title="한도 · 구독 다시 확인"
          aria-label="다시 확인"
          disabled={loading}
          onClick={() => {
            setLoading(true);
            void refresh().finally(() => setLoading(false));
          }}
        >
          {ICON_REFRESH}
        </button>
      </div>
      {installed.map((id) => (
        <ProviderSection
          key={id}
          id={id}
          status={statuses.find((s) => s.id === id)!}
          limit={items.find((l) => l.provider === id)}
          now={now}
          onLaunch={() => {
            const err = launchAgent(id, 'row');
            setNotice(err);
            if (!err) onLaunched();
          }}
          onNotice={setNotice}
        />
      ))}
      {missing.map((id) => {
        const g = PROVIDER_GLYPH[id];
        const hint = statuses.find((s) => s.id === id)?.installHint;
        return (
          <div key={id} className="u-missing" style={{ ['--pc' as string]: g.color }}>
            <span className="pglyph sm gray">{g.glyph}</span>
            <span className="name">{PROVIDER_META[id].name} · 미설치</span>
            {hint && (
              <button
                className="btn xs"
                onClick={() =>
                  void navigator.clipboard
                    .writeText(hint)
                    .then(() => setNotice('설치 명령을 복사했어요'))
                }
              >
                {ICON_COPY}설치 명령
              </button>
            )}
          </div>
        );
      })}
      <div className="u-foot">
        <label className="switch-row">
          <b>구독으로만 실행</b>
          <input type="checkbox" checked={subOnly} onChange={(e) => setSubOnly(e.target.checked)} />
          <span className="switch" />
          <small>실행 시 API 키 환경변수 제거</small>
        </label>
        {notice && <p className="u-note warn">{notice}</p>}
        <p className="u-note">
          Claude 한도는 Claude Code 세션이 응답할 때마다 갱신돼요 (LaDock 밖에서 실행한 세션 포함).
        </p>
      </div>
    </div>
  );
}

export function LimitBar() {
  const statuses = useProviders((s) => s.statuses);
  const items = useLimits((s) => s.items);
  const [hover, setHover] = useState(false);
  const [pinned, setPinned] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const timer = useRef(0);
  const open = hover || pinned;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) {
        setHover(false);
        setPinned(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      setHover(false);
      setPinned(false);
    };
    document.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  useEffect(() => () => window.clearTimeout(timer.current), []);
  useEffect(() => {
    if (open) void useLimits.getState().poll();
  }, [open]);

  const installed = PROVIDER_ORDER.filter((id) => statuses.find((s) => s.id === id)?.installed);
  if (!installed.length) return null;

  const enter = (e: React.PointerEvent) => {
    if (e.pointerType !== 'mouse') return; // 터치는 클릭만
    window.clearTimeout(timer.current);
    setHover(true);
  };
  const leave = (e: React.PointerEvent) => {
    if (e.pointerType !== 'mouse') return;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setHover(false), CLOSE_DELAY_MS);
  };
  const close = () => {
    setHover(false);
    setPinned(false);
  };

  return (
    <div ref={wrap} className="limbar" onPointerEnter={enter} onPointerLeave={leave}>
      <button
        className={`usage-pill${pinned ? ' on' : ''}`}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label="AI 한도 사용률 — 마우스를 올리면 상세"
        onClick={() => setPinned((p) => !p)}
      >
        {installed.map((id) => {
          const windows = mergeGroups(items.find((l) => l.provider === id)?.windows ?? []);
          if (!windows.length) return null;
          const worst = worstLevel(windows)!;
          const g = PROVIDER_GLYPH[id];
          return (
            <span key={id} className={`u lv-${worst}`} style={{ ['--pc' as string]: g.color }}>
              <i>{g.glyph}</i>
              {windows.map((w) => (
                <span key={w.key} className="w">
                  <span className="n">{WINDOW_META[w.key].short}</span>
                  <b>{roundPct(w.usedPct)}%</b>
                </span>
              ))}
              <span className="d" title={LEVEL_TEXT[worst]} />
            </span>
          );
        })}
      </button>
      <Popover show={open} onLaunched={close} />
    </div>
  );
}

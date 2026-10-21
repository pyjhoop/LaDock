import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { getVersion } from '@tauri-apps/api/app';
import { THEMES } from '../../app/theme';
import { PROVIDER_META, PROVIDER_ORDER } from '../ai/providers';
import { isModifierOnly, prefixLabel, type PrefixSpec } from '../keys/keymap';
import { useKeys } from '../keys/keys';
import { useLimits } from '../limits/limits';
import { useRemote } from '../remote/remote';
import { useUpdate } from '../update/updater';
import { useShells } from '../sessions/shells';
import { FONT_SIZE_RANGE, prefixWarning, useSettings } from './settings';
import './settings.css';

const BRIDGE_STATE = {
  connected: '연결됨',
  disconnected: '연결 안 됨',
  stale: '다시 연결 필요',
  unavailable: '사용 불가',
} as const;

/** statusline.js를 이미 쓰는 경우, 브리지 대신 이 한 줄로 같은 파일을 쓴다 */
const STATUSLINE_SNIPPET =
  "try{const r=input.rate_limits,w=n=>r&&r[n]&&typeof r[n].used_percentage==='number'?{usedPct:r[n].used_percentage,resetsAt:r[n].resets_at}:undefined,f=w('five_hour'),d=w('seven_day'),fs=require('fs'),dir=require('path').join(process.env.APPDATA,'LaDock','limits');if(f||d){fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(dir+'/claude.json',JSON.stringify({sessionId:input.session_id,updatedAt:Math.floor(Date.now()/1000),fiveHour:f,sevenDay:d}))}}catch{}";

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="set-row">
      <div className="set-label">
        {label}
        {hint && <small>{hint}</small>}
      </div>
      <div className="set-ctl">{children}</div>
    </div>
  );
}

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      className={`set-toggle${on ? ' on' : ''}`}
      onClick={() => onChange(!on)}
    >
      {on ? '켬' : '끔'}
    </button>
  );
}

function PrefixField() {
  const prefix = useSettings((s) => s.settings.prefix);
  const [capturing, setCapturing] = useState(false);
  const [rejected, setRejected] = useState<string | null>(null);

  useEffect(() => {
    if (!capturing) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (isModifierOnly(e)) return;
      if (e.key === 'Escape') return setCapturing(false);
      if (!/^(Key[A-Z]|Digit\d|F\d{1,2})$/.test(e.code))
        return setRejected('글자 · 숫자 · F키만 쓸 수 있어요');
      const spec: PrefixSpec = { code: e.code, ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey };
      if (!spec.ctrl && !spec.alt) return setRejected('Ctrl 또는 Alt와 함께 눌러 주세요');
      setRejected(null);
      setCapturing(false);
      useSettings.getState().update({ prefix: spec });
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [capturing]);

  const warn = rejected ?? prefixWarning(prefix);
  return (
    <>
      <button
        type="button"
        className={`set-btn${capturing ? ' on' : ''}`}
        onClick={() => {
          setRejected(null);
          setCapturing(!capturing);
        }}
      >
        {capturing ? '키를 누르세요… (Esc 취소)' : prefixLabel(prefix)}
      </button>
      {warn && <small className="set-warn">{warn}</small>}
    </>
  );
}

function BridgeField() {
  const bridge = useLimits((s) => s.bridge);
  const [confirming, setConfirming] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [snippet, setSnippet] = useState(false);
  if (!bridge) return <small>상태를 확인하는 중…</small>;

  const run = (f: () => Promise<string | null>) =>
    void f().then((err) => {
      setConfirming(false);
      setMsg(err);
    });
  const { connectBridge, disconnectBridge } = useLimits.getState();
  const connected = bridge.state === 'connected';

  return (
    <>
      <div className="set-line">
        <span className={`set-state${connected ? ' ok' : ''}`}>{BRIDGE_STATE[bridge.state]}</span>
        {connected ? (
          <button type="button" className="set-btn" onClick={() => run(disconnectBridge)}>
            연결 해제
          </button>
        ) : (
          bridge.state !== 'unavailable' &&
          !confirming && (
            <button type="button" className="set-btn" onClick={() => setConfirming(true)}>
              {bridge.state === 'stale' ? '다시 연결' : '연결'}
            </button>
          )
        )}
      </div>
      <small>{bridge.detail}</small>
      {confirming && (
        <div className="set-confirm">
          <p>
            <code>~/.claude/settings.json</code>의 statusLine을 LaDock 브리지로 감쌉니다. 변경 전에
            백업하고, 언제든 [연결 해제]로 되돌릴 수 있어요.
          </p>
          <button type="button" className="set-btn primary" onClick={() => run(connectBridge)}>
            확인하고 연결
          </button>
          <button type="button" className="set-btn" onClick={() => setConfirming(false)}>
            취소
          </button>
        </div>
      )}
      {msg && <small className="set-warn">{msg}</small>}
      <button type="button" className="set-link" onClick={() => setSnippet(!snippet)}>
        {snippet ? '▾' : '▸'} 이미 쓰는 statusline.js에 직접 추가하려면
      </button>
      {snippet && (
        <div className="set-snippet">
          <p>
            브리지 대신, 쓰던 <code>statusline.js</code>에서 stdin JSON을 파싱한 변수(아래는{' '}
            <code>input</code>) 바로 뒤에 이 한 줄을 넣으면 같은 <code>limits\claude.json</code>을
            씁니다. 설정 파일은 건드리지 않아요.
          </p>
          <pre>{STATUSLINE_SNIPPET}</pre>
          <button
            type="button"
            className="set-btn"
            onClick={() =>
              void navigator.clipboard
                .writeText(STATUSLINE_SNIPPET)
                .then(() => setMsg('한 줄을 복사했어요'))
            }
          >
            복사
          </button>
        </div>
      )}
    </>
  );
}

function UpdateField() {
  const { phase, version, progress, error } = useUpdate();
  const [current, setCurrent] = useState('');
  useEffect(() => void getVersion().then(setCurrent, () => {}), []);
  const { check, install } = useUpdate.getState();

  const busy = phase === 'checking' || phase === 'installing';
  const hasUpdate = version !== null && phase !== 'uptodate';
  const status =
    phase === 'checking'
      ? '확인하는 중…'
      : phase === 'installing'
        ? `받는 중${progress === null ? '…' : ` ${progress}%`} — 끝나면 다시 시작해요`
        : phase === 'error'
          ? `실패: ${error}`
          : phase === 'uptodate'
            ? '최신 버전이에요'
            : hasUpdate
              ? `새 버전 ${version}이 있어요`
              : null;

  return (
    <>
      <div className="set-line">
        <span className="set-state">현재 {current ? `v${current}` : '…'}</span>
        <button
          type="button"
          className={`set-btn${hasUpdate ? ' primary' : ''}`}
          disabled={busy}
          onClick={() => void (hasUpdate ? install() : check())}
        >
          {hasUpdate ? '업데이트하고 다시 시작' : '업데이트 확인'}
        </button>
      </div>
      {status && <small className={phase === 'error' ? 'set-warn' : undefined}>{status}</small>}
    </>
  );
}

function RemoteField() {
  const { status, busy, refresh, setEnabled, setHttps, regenerate } = useRemote();
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), 3000);
    return () => clearInterval(t);
  }, [refresh]);

  const shownUrl = status?.httpsUrl ?? status?.url ?? '';
  const state = !status
    ? '확인하는 중…'
    : status.running
      ? `켜짐 — 연결된 폰 ${status.clients}대`
      : status.enabled
        ? '켜짐 대기 중 (Tailscale 연결을 기다리는 중)'
        : '꺼짐';

  return (
    <>
      <Row label="모바일 접속" hint="Tailscale 주소로만 열려요. 같은 tailnet의 폰에서 접속">
        <Toggle on={status?.enabled ?? false} onChange={(v) => void setEnabled(v)} />
      </Row>
      <Row
        label="HTTPS"
        hint="tailscale serve로 https 주소를 열어요 (붙여넣기 · 홈 화면 추가에 필요)"
      >
        <Toggle on={status?.https ?? true} onChange={(v) => void setHttps(v)} />
      </Row>
      <div className="set-block">
        <div className="set-line">
          <span className="set-state">{state}</span>
        </div>
        {status?.error && <small className="set-warn">{status.error}</small>}
        {(status?.httpsUrl ?? status?.url) && (
          <>
            <small>
              폰 브라우저에서 이 주소를 여세요 (토큰이 들어 있으니 남에게 보여주지 마세요)
            </small>
            <pre className="set-url">{shownUrl}</pre>
            <div className="set-line">
              <button
                type="button"
                className="set-btn"
                onClick={() =>
                  void navigator.clipboard
                    .writeText(shownUrl)
                    .then(() => setMsg('주소를 복사했어요'))
                }
              >
                주소 복사
              </button>
              <button
                type="button"
                className="set-btn"
                disabled={busy}
                onClick={() => {
                  if (
                    window.confirm(
                      '토큰을 새로 만들면 지금 폰은 끊기고 이전 주소는 못 씁니다. 계속할까요?',
                    )
                  )
                    void regenerate().then(() => setMsg('토큰을 재발급했어요'));
                }}
              >
                토큰 재발급
              </button>
            </div>
          </>
        )}
        {msg && <small>{msg}</small>}
        <small>
          PC에 열린 세션 · 탭 · pane을 그대로 보고 입력합니다. 처음 켜면 Windows 방화벽이 허용을
          물을 수 있어요 (개인 네트워크 허용).
        </small>
      </div>
    </>
  );
}

const SECTIONS = [
  { id: 'terminal', label: '터미널' },
  { id: 'ai', label: 'AI 실행' },
  { id: 'remote', label: '모바일 접속' },
  { id: 'update', label: '업데이트' },
  { id: 'limits', label: 'Claude 한도 연동' },
] as const;
type SectionId = (typeof SECTIONS)[number]['id'];

/** 설정 페이지. 오버레이가 아니라 작업 영역을 대신해서 보인다 (터미널은 계속 살아 있다). */
export function SettingsPage() {
  const close = useKeys((s) => s.closeOverlay);
  const s = useSettings((st) => st.settings);
  const update = useSettings((st) => st.update);
  const profiles = useShells((st) => st.profiles);
  const pageRef = useRef<HTMLDivElement>(null);
  const [section, setSection] = useState<SectionId>('terminal');

  useEffect(() => {
    if (useShells.getState().profiles.length === 0) void useShells.getState().load();
    (document.activeElement as HTMLElement | null)?.blur();
    pageRef.current?.focus();
  }, []);

  const commitOnEnter = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === 'Enter') e.currentTarget.blur();
  };

  return (
    <div
      ref={pageRef}
      tabIndex={-1}
      className="settings-page"
      onKeyDown={(e) => {
        if (e.key === 'Escape' && !(e.target instanceof HTMLInputElement)) close();
      }}
    >
      <nav className="settings-nav">
        <button type="button" className="settings-back" onClick={close}>
          ← 터미널로
        </button>
        {SECTIONS.map((sec) => (
          <button
            key={sec.id}
            type="button"
            className={sec.id === section ? 'on' : undefined}
            onClick={() => setSection(sec.id)}
          >
            {sec.label}
          </button>
        ))}
      </nav>
      <div className="settings-content">
        <div className="settings-inner">
          <h2>{SECTIONS.find((x) => x.id === section)?.label}</h2>
          <p className="muted">바꾸면 바로 적용되고 자동으로 저장됩니다. Esc로 돌아가기</p>

          {section === 'terminal' && (
            <>
              <Row label="기본 셸" hint="새 세션 · 분할에 쓰는 셸">
                <select
                  value={s.defaultShell}
                  onChange={(e) => update({ defaultShell: e.target.value })}
                >
                  {!profiles.some((p) => p.id === s.defaultShell) && (
                    <option value={s.defaultShell}>{s.defaultShell} (감지 안 됨)</option>
                  )}
                  {profiles.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </Row>
              <Row label="폰트" hint="설치된 폰트 이름">
                <input
                  key={s.fontFamily}
                  defaultValue={s.fontFamily}
                  onKeyDown={commitOnEnter}
                  onBlur={(e) =>
                    e.target.value.trim() && update({ fontFamily: e.target.value.trim() })
                  }
                />
              </Row>
              <Row label="폰트 크기">
                <div className="set-stepper">
                  <button
                    type="button"
                    disabled={s.fontSize <= FONT_SIZE_RANGE.min}
                    onClick={() => update({ fontSize: s.fontSize - 1 })}
                  >
                    −
                  </button>
                  <span>{s.fontSize}</span>
                  <button
                    type="button"
                    disabled={s.fontSize >= FONT_SIZE_RANGE.max}
                    onClick={() => update({ fontSize: s.fontSize + 1 })}
                  >
                    +
                  </button>
                </div>
              </Row>
              <Row label="테마">
                <div className="set-seg wrap">
                  {THEMES.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      className={t.id === s.theme ? 'on' : undefined}
                      onClick={() => update({ theme: t.id })}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              </Row>
              <Row label="선택하면 자동 복사">
                <Toggle on={s.copyOnSelect} onChange={(v) => update({ copyOnSelect: v })} />
              </Row>
              <Row label="prefix 키" hint="누르고 2초 안에 다음 키">
                <PrefixField />
              </Row>
            </>
          )}

          {section === 'ai' && (
            <>
              <Row label="구독으로만 실행" hint="API 키 환경변수를 지우고 실행">
                <Toggle on={s.subscriptionOnly} onChange={(v) => update({ subscriptionOnly: v })} />
              </Row>
              <Row label="권한 확인 생략" hint="CLI의 권한 확인 건너뛰기 플래그">
                <Toggle on={s.skipPermissions} onChange={(v) => update({ skipPermissions: v })} />
              </Row>
              {PROVIDER_ORDER.map((id) => (
                <Row
                  key={id}
                  label={`${PROVIDER_META[id].name} 인자`}
                  hint="예: --model opus --continue"
                >
                  <input
                    key={s.providerArgs[id]}
                    defaultValue={s.providerArgs[id]}
                    placeholder="추가 인자 없음"
                    onKeyDown={commitOnEnter}
                    onBlur={(e) =>
                      update({ providerArgs: { ...s.providerArgs, [id]: e.target.value.trim() } })
                    }
                  />
                </Row>
              ))}
            </>
          )}

          {section === 'remote' && <RemoteField />}

          {section === 'update' && (
            <>
              <div className="set-block">
                <UpdateField />
              </div>
            </>
          )}

          {section === 'limits' && (
            <>
              <div className="set-block">
                <BridgeField />
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

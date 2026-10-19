import { useEffect, useState } from 'react';
import { StatusBar } from '../components/StatusBar';
import { TitleBar } from '../components/TitleBar';
import { useProviders } from '../features/ai/providers';
import { useLimits } from '../features/limits/limits';
import { Overlays } from '../features/keys/Overlays';
import { useKeys } from '../features/keys/keys';
import { SettingsPage } from '../features/settings/SettingsPage';
import { remoteClient } from '../features/remote/client';
import { KeyBar, RemoteGate } from '../features/remote/RemoteGate';
import { startRemotePublish } from '../features/remote/publish';
import { installKeyHandler } from '../features/keys/keys';
import { startSettingsApply } from '../features/settings/apply';
import { UpdateBanner } from '../features/update/UpdateBanner';
import { useUpdate } from '../features/update/updater';
import { RestoreGate } from '../features/persist/RestoreGate';
import { PaneChips } from '../features/layout/PaneChips';
import { Workspace } from '../features/layout/Workspace';
import { Sidebar } from '../features/sessions/Sidebar';
import { layoutModeOf, useSessionsUi } from '../features/sessions/ui';
import { TerminalPane } from '../features/terminal/TerminalPane';

// M0-04 검증용: `?stress=20`이면 터미널 N개를 띄우고 WebGL/DOM 렌더러 수를 보여준다.
const stress = import.meta.env.DEV ? Number(new URLSearchParams(location.search).get('stress')) : 0;

function StressGrid({ count }: { count: number }) {
  const [renderers, setRenderers] = useState<Record<number, 'webgl' | 'dom'>>({});
  const values = Object.values(renderers);
  const webgl = values.filter((r) => r === 'webgl').length;
  const dom = values.filter((r) => r === 'dom').length;
  return (
    <>
      <div style={{ padding: 4, fontSize: 12 }}>
        터미널 {count}개 · WebGL {webgl} · DOM 폴백 {dom}
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(5, 1fr)',
          gap: 2,
          flex: 1,
          minHeight: 0,
        }}
      >
        {Array.from({ length: count }, (_, i) => (
          <TerminalPane
            key={i}
            profileId="pwsh"
            title={`pwsh ${i + 1}`}
            onRenderer={(r) => setRenderers((prev) => ({ ...prev, [i]: r }))}
          />
        ))}
      </div>
    </>
  );
}

export function App() {
  const Gate = remoteClient ? RemoteGate : RestoreGate;
  useEffect(() => installKeyHandler(), []);
  useEffect(() => (remoteClient ? undefined : startRemotePublish()), []);
  const settingsOpen = useKeys((s) => s.overlay?.kind === 'settings');
  useEffect(() => startSettingsApply(), []);
  useEffect(() => void useProviders.getState().load(), []);
  useEffect(() => void useLimits.getState().load(), []);
  useEffect(() => {
    if (!import.meta.env.PROD || remoteClient) return;
    const t = window.setTimeout(() => void useUpdate.getState().check({ silent: true }), 3000);
    return () => window.clearTimeout(t);
  }, []);
  const narrow = useSessionsUi((s) => s.mode === 'narrow');
  useEffect(() => {
    const onResize = () => {
      const mode = layoutModeOf(window.innerWidth);
      if (mode !== useSessionsUi.getState().mode) useSessionsUi.getState().setMode(mode);
    };
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return (
    <Gate>
      <div className="app">
        <TitleBar />
        {settingsOpen && <SettingsPage />}
        {/* 설정 페이지 동안에도 터미널이 살아 있도록 언마운트하지 않고 숨긴다 */}
        <main
          className="main"
          style={{
            ...(stress ? { flexDirection: 'column' } : null),
            ...(settingsOpen ? { display: 'none' } : null),
          }}
        >
          {stress ? (
            <StressGrid count={stress} />
          ) : (
            <>
              <Sidebar />
              <div className="work">
                {narrow && <PaneChips />}
                <Workspace />
              </div>
            </>
          )}
        </main>
        {remoteClient && <KeyBar />}
        <StatusBar />
        <Overlays />
        <UpdateBanner />
      </div>
    </Gate>
  );
}

import { useEffect, useState } from 'react';
import { TitleBar } from '../components/TitleBar';
import { Overlays } from '../features/keys/Overlays';
import { installKeyHandler } from '../features/keys/keys';
import { Workspace } from '../features/layout/Workspace';
import { Sidebar } from '../features/sessions/Sidebar';
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
  useEffect(() => installKeyHandler(), []);
  return (
    <div className="app">
      <TitleBar />
      <main className="main" style={stress ? { flexDirection: 'column' } : undefined}>
        {stress ? (
          <StressGrid count={stress} />
        ) : (
          <>
            <Sidebar />
            <Workspace />
          </>
        )}
      </main>
      <Overlays />
    </div>
  );
}

import { TitleBar } from '../components/TitleBar';
import { TerminalPane } from '../features/terminal/TerminalPane';

export function App() {
  return (
    <div className="app">
      <TitleBar />
      <main className="main">
        <TerminalPane profileId="pwsh" title="pwsh" />
      </main>
    </div>
  );
}

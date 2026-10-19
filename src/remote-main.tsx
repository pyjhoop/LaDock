// 모바일 원격 진입점. 데스크톱과 같은 App을 띄우되, Tauri 대신 PC와 WebSocket으로 연결한다.
import React from 'react';
import ReactDOM from 'react-dom/client';
import { installTauriShim, dispatchEvent } from './features/remote/shim';
import { remoteClient, startRemoteClient } from './features/remote/client';
import { App } from './app/App';
import { applyTheme, loadTheme } from './app/theme';
import './app/theme.css';
import './app/app.css';

installTauriShim();
startRemoteClient();
remoteClient?.onEvent(dispatchEvent);
applyTheme(loadTheme());

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

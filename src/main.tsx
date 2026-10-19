import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './app/App';
import { applyTheme, loadTheme } from './app/theme';
import './app/theme.css';
import './app/app.css';

applyTheme(loadTheme());

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

/**
 * @file packages/frontend/src/main.tsx
 * @description Entrypoint mounting React root component into HTML DOM.
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './app/App.js';

const rootElement = document.getElementById('root');
if (rootElement) {
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}

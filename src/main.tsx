import React from 'react';
import ReactDOM from 'react-dom/client';
import { SessionProvider } from './contexts/SessionContext';
import { WebSocketProvider } from './contexts/WebSocketContext';
import App from './App';
import './index.css';

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <SessionProvider>
      <WebSocketProvider>
        <App />
      </WebSocketProvider>
    </SessionProvider>
  </React.StrictMode>,
);

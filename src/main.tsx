import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './app/App';
import AuthGate from './app/AuthGate';
import { AWS_AUTH_ENABLED } from './services/runtimeServices';
import './styles/tokens.css';
import './styles/app.css';
import './styles/print.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {AWS_AUTH_ENABLED ? <AuthGate>{(user, logout) => <App key={user.username} authUser={user.username} onLogout={logout} />}</AuthGate> : <App />}
  </StrictMode>,
);

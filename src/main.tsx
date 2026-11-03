import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/tokens.css';
import './styles/app.css';
import './styles/projects.css';
import './styles/identity.css';

const root = document.getElementById('root');
if (!root) throw new Error('Application root is missing');

async function start(root: HTMLElement) {
  const mode = document.querySelector('meta[name="timeline-storage"]')?.getAttribute('content');
  if (mode === 'local') {
    const [{ FoundationApp }, { V2Repository }, { CommandService }] = await Promise.all([
      import('./app/FoundationApp'), import('./infrastructure/local/V2Repository'), import('./application/v2/CommandService'),
    ]);
    const service = new CommandService(new V2Repository());
    createRoot(root).render(<StrictMode><FoundationApp service={service} /></StrictMode>);
  } else if (mode === 'server') {
    const params = new URLSearchParams(location.search);
    const resetToken = params.get('token') ?? undefined;
    const verified = params.get('auth') === 'verified';
    // Mail tokens live only in memory, never in storage or subsequent URL/referrer.
    if (location.search) history.replaceState(null, '', location.pathname + location.hash);
    const { ServerApp } = await import('./app/ServerApp');
    createRoot(root).render(<StrictMode><ServerApp {...(resetToken ? { resetToken } : {})} verified={verified} /></StrictMode>);
  } else {
    root.textContent = 'Не задан режим хранения TIMELINE. Проверьте конфигурацию размещения.';
  }
}
void start(root).catch(() => { root.textContent = "Не удалось запустить TIMELINE. Проверьте конфигурацию и подключение."; });

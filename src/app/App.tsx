import { useState } from 'react';
import type { ProjectDocument } from '../domain';
import { ProjectOverview } from '../features/projects/ProjectOverview';
import { TimelineWorkspace } from '../features/timeline/TimelineWorkspace';

type Screen = 'projects' | 'timeline';

export function App({ demoDocument }: { readonly demoDocument: ProjectDocument }) {
  const [screen, setScreen] = useState<Screen>('timeline');
  const [document, setDocument] = useState(demoDocument);

  return (
    <div className="app-shell">
      <header className="app-header">
        <a className="brand" href="#timeline" onClick={() => { setScreen('timeline'); }}><span className="brand-mark" aria-hidden="true">т</span>Таймлайн</a>
        <nav aria-label="Основная навигация">
          <button className="nav-link" aria-current={screen === 'projects' ? 'page' : undefined} onClick={() => { setScreen('projects'); }}>Проекты</button>
        </nav>
        <div className="header-project"><span>/</span><strong>{document.project.name}</strong><small>Анимационный сериал</small></div>
        <span className="workspace-label">Демо · без сохранения</span>
      </header>
      {screen === 'timeline' ? <TimelineWorkspace document={document} onCommit={setDocument} /> : <main className="project-overview"><ProjectOverview demo={document} onShowDemo={() => { setScreen('timeline'); }} onOpenDemo={() => { setScreen('timeline'); }} /></main>}
    </div>
  );
}

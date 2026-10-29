import { useState } from 'react';
import type { ProjectDocument } from '../domain';
import { ProjectOverview } from '../features/projects/ProjectOverview';
import { ProjectSummary } from '../features/projects/ProjectSummary';

type Screen = 'projects' | 'project-summary';

export function App({ demoDocument }: { readonly demoDocument: ProjectDocument }) {
  const [screen, setScreen] = useState<Screen>('projects');
  const [demoVisible, setDemoVisible] = useState(false);

  return (
    <div className="app-shell">
      <header className="app-header">
        <a className="brand" href="#projects" onClick={() => { setScreen('projects'); }}><span className="brand-mark" aria-hidden="true">т</span>Таймлайн</a>
        <nav aria-label="Основная навигация">
          <button className="nav-link" aria-current={screen === 'projects' ? 'page' : undefined} onClick={() => { setScreen('projects'); }}>Проекты</button>
        </nav>
        <span className="workspace-label">Личное пространство</span>
      </header>
      <main id="main-content" key={screen}>
        {screen === 'project-summary' && <button className="back-link" onClick={() => { setScreen('projects'); }}>← Все проекты</button>}
        {screen === 'projects' ? <ProjectOverview demo={demoVisible ? demoDocument : null} onShowDemo={() => { setDemoVisible(true); }} onOpenDemo={() => { setScreen('project-summary'); }} /> : <ProjectSummary document={demoDocument} />}
      </main>
      <footer className="app-footer">Таймлайн<span>Планы обретают форму</span></footer>
    </div>
  );
}

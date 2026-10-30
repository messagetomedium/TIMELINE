import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { productionDemo } from './infrastructure/demo/production';
import { IndexedDbProjectRepository } from './infrastructure/local/IndexedDbProjectRepository';
import { WorkspaceService } from './application/workspace/WorkspaceService';
import './styles/tokens.css';
import './styles/app.css';
import './styles/projects.css';

const root = document.getElementById('root');
if (!root) throw new Error('Application root is missing');

const service = new WorkspaceService(new IndexedDbProjectRepository(), productionDemo);
createRoot(root).render(<StrictMode><App service={service} /></StrictMode>);

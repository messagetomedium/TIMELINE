import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { FoundationApp } from './app/FoundationApp';
import { V2Repository } from './infrastructure/local/V2Repository';
import { CommandService } from './application/v2/CommandService';
import './styles/tokens.css';
import './styles/app.css';
import './styles/projects.css';

const root = document.getElementById('root');
if (!root) throw new Error('Application root is missing');

const service = new CommandService(new V2Repository());
createRoot(root).render(<StrictMode><FoundationApp service={service} /></StrictMode>);

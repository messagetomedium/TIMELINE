import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { productionDemo } from './infrastructure/demo/production';
import './styles/tokens.css';
import './styles/app.css';

const root = document.getElementById('root');
if (!root) throw new Error('Application root is missing');

createRoot(root).render(<StrictMode><App demoDocument={productionDemo} /></StrictMode>);

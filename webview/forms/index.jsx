import { render } from 'solid-js/web';
import { controller } from './controller.js';
import { App } from './App.jsx';
import './style.css';
const c = controller(acquireVsCodeApi());
render(() => <App controller={c}/>, document.getElementById('root'));
window.addEventListener('unload', () => c.dispose(), { once: true });

import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { createDesignerController } from '../../resources/query/controller.mjs';
import { ConstructorApp } from './App.jsx';

const root = document.getElementById('root');
const [view, update] = createSignal();
const controller = createDesignerController(acquireVsCodeApi(), root, update);
render(() => <ConstructorApp controller={controller} view={view} />, root);
controller.start();

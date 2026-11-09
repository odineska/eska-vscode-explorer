import { flag, number } from './model.mjs';

export const additionKinds = new Set(['SearchStringAddition', 'SearchControlAddition', 'ViewStatusAddition']);

export function additionStretches(node) {
  return node.kind !== 'SearchControlAddition' && additionKinds.has(node.kind);
}

export function additionWidth(node, os, inline, stretch) {
  const control = node.kind === 'SearchControlAddition';
  const search = node.kind === 'SearchStringAddition';
  const unit = os === 'linux' ? 10 : 8;
  const intrinsic = control ? 50 : inline && search ? 111 : 300;
  const requested = number(node, 'Width');
  const preferred = requested > 0 ? requested * unit : intrinsic;
  const limit = !flag(node, 'AutoMaxWidth') ? number(node, 'MaxWidth') : 0;
  const maximum = stretch && limit > 0 ? limit * unit + (os === 'linux' && search ? 10 : 0) : undefined;
  const minimum = stretch && !control ? Math.min(preferred, search ? 111 : inline ? 300 : 80) : preferred;
  return { preferred: Math.min(preferred, maximum ?? Infinity), minimum: Math.min(minimum, maximum ?? Infinity), maximum };
}

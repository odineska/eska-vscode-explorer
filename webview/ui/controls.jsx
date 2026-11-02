import { splitProps } from 'solid-js';

/** Accessible controls share the same stylesheet with the non-Solid webviews. */
export function Button(props) {
  const [local, rest] = splitProps(props, ['children', 'primary', 'quiet', 'class']);
  return <button type="button" {...rest} class={`eska-button ${local.primary ? 'primary' : ''} ${local.quiet ? 'eska-button--quiet' : ''} ${local.class ?? ''}`}>{local.children}</button>;
}

export function Toolbar(props) {
  return <div role="toolbar" aria-label={props.label} class={`eska-toolbar ${props.class ?? ''}`}>{props.children}</div>;
}

import { omit } from 'solid-js';

/** Accessible controls share the same stylesheet with the non-Solid webviews. */
export function Button(props) {
  const rest = omit(props, 'children', 'primary', 'quiet', 'class');
  return <button type="button" {...rest} class={`eska-button ${props.primary ? 'primary' : ''} ${props.quiet ? 'eska-button--quiet' : ''} ${props.class ?? ''}`}>{props.children}</button>;
}

export function Toolbar(props) {
  return <div role="toolbar" aria-label={props.label} class={`eska-toolbar ${props.class ?? ''}`}>{props.children}</div>;
}

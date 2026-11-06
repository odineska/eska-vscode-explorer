import { For, Show, createEffect, on, onCleanup } from 'solid-js';
import { buttonBorderPaint } from './button-border.mjs';
import { observeTableRasterPosition } from './table-raster-position.js';
import { useFormLayout } from './responsive-layout.js';

const REGIONS = [['topLeft',false,false,3],['topRight',true,false,3],['bottomLeft',false,true,4],['bottomRight',true,true,4]];
const rgb = value => /^rgb\((\d+), (\d+), (\d+)\)$/.exec(value)?.slice(1).map(Number);
function backdrop(element) {
  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    const css = getComputedStyle(parent);
    if (css.backgroundImage !== 'none') return;
    if (css.backgroundColor !== 'rgba(0, 0, 0, 0)') return rgb(css.backgroundColor);
  }
}

export function NativeButtonBorder(props) {
  const layout = useFormLayout();
  createEffect(on(() => [props.enabled,props.primary,props.controller.state.sequence,props.controller.state.ui.zoom,layout?.preferred()],() => {
    const button = props.button();
    if (!props.enabled) { props.setPaint(undefined); return; }
    const draw = () => {
      const css = getComputedStyle(button), height = parseFloat(css.height), background = rgb(css.backgroundColor), outside = backdrop(button);
      if (!Number.isInteger(height) || height < 7 || height > 4096 || !background || !outside) { props.setPaint(undefined); return; }
      props.setPaint(buttonBorderPaint({height,background,outside,primary:props.primary,position:position(height,props.controller.state.ui.zoom)}));
    };
    const frame = requestAnimationFrame(draw), observer = new ResizeObserver(draw);
    const position = observeTableRasterPosition(button,observer);
    observer.observe(button);
    onCleanup(() => { cancelAnimationFrame(frame); observer.disconnect(); });
  }));
  return <span class="taxi-button-border" data-native-button-border={props.paint ? 'ready' : 'fallback'} aria-hidden="true">
    <Show when={props.paint}><For each={REGIONS}>{([name,right,bottom,height]) => <svg class="taxi-button-corner" width="3" height={height} viewBox={`0 0 3 ${height}`} shape-rendering="crispEdges"
      style={{left:right ? undefined : '-1px',right:right ? '-1px' : undefined,top:bottom ? undefined : '-1px',bottom:bottom ? '-2px' : undefined}}>
      <For each={props.paint.corners[name]}>{(pixel,index) => <rect x={index() % 3} y={Math.floor(index() / 3)} width="1" height="1" fill={`rgb(${pixel.join(',')})`}/>}</For>
    </svg>}</For></Show>
  </span>;
}

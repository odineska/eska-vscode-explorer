import { For, Show, createEffect, on, onCleanup } from 'solid-js';
import { buttonBorderPaint } from './button-border.mjs';
import { observeRasterPaint } from './raster-position.js';
import { useFormLayout } from './responsive-layout.js';
import { rgb, solidBackdrop } from './native-control-paint.js';

const REGIONS = [['topLeft',false,false,3],['topRight',true,false,3],['bottomLeft',false,true,4],['bottomRight',true,true,4]];

export function NativeButtonBorder(props) {
  const layout = useFormLayout();
  createEffect(on(() => [props.enabled,props.primary,props.stroke,props.inactive,props.controller.state.modelSequence,props.controller.state.ui.zoom,layout?.preferred()],() => {
    const button = props.button();
    if (!props.enabled) { props.setPaint(undefined); return; }
    onCleanup(observeRasterPaint(button,position => {
      const css = getComputedStyle(button), height = parseFloat(css.height), background = rgb(css.backgroundColor), outside = solidBackdrop(button.parentElement);
      if (!Number.isInteger(height) || height < 7 || height > 4096 || !background || !outside) { props.setPaint(undefined); return; }
      props.setPaint(buttonBorderPaint({height,background,outside,primary:props.primary,stroke:props.stroke ? rgb(css.borderTopColor) : undefined,inactive:props.inactive,position:position(height,props.controller.state.ui.zoom)}));
    }));
  }));
  return <span class="taxi-button-border" data-native-button-border={props.paint ? 'ready' : 'fallback'} aria-hidden="true">
    <Show when={props.paint}><For each={REGIONS}>{([name,right,bottom,height]) => <svg class="taxi-button-corner" width="3" height={height} viewBox={`0 0 3 ${height}`} shape-rendering="crispEdges"
      style={{left:right ? undefined : '-1px',right:right ? '-1px' : undefined,top:bottom ? undefined : '-1px',bottom:bottom ? '-2px' : undefined}}>
      <For each={props.paint.corners[name]}>{(pixel,index) => <rect x={index() % 3} y={Math.floor(index() / 3)} width="1" height="1" fill={`rgb(${pixel.join(',')})`}/>}</For>
    </svg>}</For></Show>
  </span>;
}

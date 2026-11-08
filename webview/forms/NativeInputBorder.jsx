import { createEffect, on, onCleanup } from 'solid-js';
import { color, flag, property } from './model.mjs';
import { inputBorderPixels, disabledInputForeground } from './input-border.mjs';
import { NativeInputCorners } from './NativeInputCorners.jsx';

function rgb(value) {
  const match = /^rgb\((\d+), (\d+), (\d+)\)$/.exec(value);
  return match?.slice(1).map(Number);
}
function backdrop(element) {
  for(let node=element.parentElement;node;node=node.parentElement) {
    const style=getComputedStyle(node);
    if(style.backgroundImage!=='none') return;
    if(style.backgroundColor!=='rgba(0, 0, 0, 0)') return rgb(style.backgroundColor);
  }
}

export function NativeInputBorder(props) {
  let source, lastKey;
  const node=()=>props.node, state=props.controller.state;
  // A parent's background can change while reconciliation retains the child node.
  createEffect(on(()=>[state.sequence,state.os,props.choice,JSON.stringify(node().presentation.border),JSON.stringify(node().presentation.background)],()=>{
    const frame=requestAnimationFrame(()=>{
      const surface=props.surface(), kind=node().presentation.valueType.kind, buttons=[...surface.querySelectorAll('.taxi-input-button')];
      const disabled=!!surface.closest('.taxi-disabled'),inactive=flag(node(),'ReadOnly',false)||disabled;
      const supported=state.os==='linux'&&!flag(node(),'MultiLine',false)&&['string','number','date'].includes(kind)
        && buttons.length<=1&&buttons.every(button=>button.classList.contains('taxi-input-button--choice'))
        && surface.getBoundingClientRect().height>=6;
      if(!supported){lastKey=undefined;props.setPaint(undefined);return;}
      const css=getComputedStyle(source),border=rgb(css.color),background=rgb(css.backgroundColor),outside=backdrop(surface);
      if(!border||!background||!outside){lastKey=undefined;props.setPaint(undefined);return;}
      const choice=buttons.length===1,key=JSON.stringify([border,background,outside,inactive,disabled,choice,!!property(node(),'BorderColor')]);
      if(key===lastKey)return;
      lastKey=key;
      const pixels=inputBorderPixels(border,background,outside,{inactive,choice,explicitBorder:!!property(node(),'BorderColor')});
      props.setPaint({...pixels,outside,inactive,choice,foreground:disabled?disabledInputForeground(background):undefined,buttonBorder:inactive?[215,215,215]:border});
    });
    // Wait for Solid to apply ancestor styles before reading the backdrop.
    onCleanup(()=>cancelAnimationFrame(frame));
  }));
  return <><span ref={source} hidden aria-hidden="true" style={{color:color(node().presentation.border),'background-color':color(node().presentation.background)}}/>
    <NativeInputCorners paint={props.paint}/>
  </>;
}

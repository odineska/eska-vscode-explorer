import { createEffect, createSignal, on, onCleanup } from 'solid-js';

/** The native painted group leaves one row of its parent's background at each end. */
export function createNativeGroupBackdrop(element, request) {
  const [outside,setOutside]=createSignal();
  createEffect(on(request, value=>{
    if(!value.enabled){setOutside();return;}
    const frame=requestAnimationFrame(()=>{
      for(let node=element()?.parentElement;node;node=node.parentElement){
        const style=getComputedStyle(node);
        if(style.backgroundImage!=='none')break;
        if(style.backgroundColor==='rgba(0, 0, 0, 0)')continue;
        setOutside(/^rgb\(\d+, \d+, \d+\)$/.test(style.backgroundColor)?style.backgroundColor:undefined);return;
      }
      setOutside();
    });
    onCleanup(()=>cancelAnimationFrame(frame));
  }));
  return outside;
}

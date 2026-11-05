const assert=require('node:assert/strict');
const {until}=require('./webview-host.cjs');
const css=hex=>'rgb('+hex.slice(1).match(/../g).map(value=>parseInt(value,16)).join(', ')+')';
async function sample({ui,view,reference,label,detached=false}){
  await until(()=>ui.evaluate("document.querySelectorAll('[data-native-link=ready]').length===4&&!document.querySelector('[data-native-link=pending]')&&[...document.querySelectorAll('.taxi-button--link')].every(node=>node.style.width)"),'four native LCD link captions');
  const selected=view.selected;
  await ui.evaluate("document.querySelector('.taxi-form-title').click()");await until(()=>view.selected?.key.kind==='root','reference frame selected');
  try{
    await ui.evaluate('document.fonts.ready.then(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))');
    const actual=await ui.evaluate(`(()=>{const rect=node=>{const r=node.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height}};return{frame:rect(document.querySelector('.taxi-form-frame')),links:[...document.querySelectorAll('.taxi-button--link')].map(button=>{const canvas=button.querySelector('canvas');return{text:button.getAttribute('aria-label'),color:getComputedStyle(button).color,button:rect(button),canvas:rect(canvas),width:canvas.width,height:canvas.height}})}})()`);
    const expected=actual.links.map(link=>{const row=reference.rows.find(row=>row.text===link.text&&css(row.foreground)===link.color);assert.ok(row,link.text+' native color');assert.deepEqual([link.width,link.height],row.region.slice(2),link.text+' bitmap dimensions');assert.deepEqual([link.canvas.width,link.canvas.height],[link.width,link.height],link.text+' unscaled canvas');return row});
    const target=detached?await ui.nativeWindow({detached:true}):undefined;let pixels,captureAttempts=0;
    await until(async()=>{
      captureAttempts++;const name=`link-pixels-${label}.png`,png=target?await ui.captureTarget(target.targetId,name,true):await ui.screenshot(name,true);
      pixels=await ui.evaluate(`(async()=>{
        if(devicePixelRatio!==1)throw new Error('link-reference-dpi');
        const image=await createImageBitmap(new Blob([Uint8Array.from(atob(${JSON.stringify(png)}),v=>v.charCodeAt(0))],{type:'image/png'}));const canvas=new OffscreenCanvas(image.width,image.height),context=canvas.getContext('2d');context.drawImage(image,0,0);image.close();const data=context.getImageData(0,0,canvas.width,canvas.height).data,blue=new Set(),frames=[];
        for(let n=0;n<canvas.width*canvas.height;n++)if(data[n*4]===30&&data[n*4+1]===144&&data[n*4+2]===255)blue.add(n);
        while(blue.size){const seed=blue.values().next().value,stack=[seed];blue.delete(seed);let left=canvas.width,top=canvas.height,right=0,bottom=0;while(stack.length){const n=stack.pop(),x=n%canvas.width,y=Math.floor(n/canvas.width);left=Math.min(left,x);top=Math.min(top,y);right=Math.max(right,x);bottom=Math.max(bottom,y);for(const adjacent of[x?n-1:-1,x+1<canvas.width?n+1:-1,y?n-canvas.width:-1,y+1<canvas.height?n+canvas.width:-1])if(blue.delete(adjacent))stack.push(adjacent)}if(right-left+1===${actual.frame.width}-2&&bottom-top+1===${actual.frame.height}-2)frames.push({x:left-1,y:top-1})}
        if(frames.length!==1)return{waitingForFrame:true,frames};const origin=frames[0],output=[];
        for(const link of ${JSON.stringify(actual.links)}){const r={x:origin.x+link.canvas.x-${actual.frame.x},y:origin.y+link.canvas.y-${actual.frame.y},width:link.width,height:link.height};if(!Number.isInteger(r.x)||!Number.isInteger(r.y))throw new Error('link-bitmap-not-aligned '+JSON.stringify(r));const rgb=new Uint8Array(r.width*r.height*3);let offset=0;for(let y=0;y<r.height;y++)for(let x=0;x<r.width;x++){const p=((r.y+y)*canvas.width+r.x+x)*4;for(let c=0;c<3;c++)rgb[offset++]=data[p+c]}const hash=new Uint8Array(await crypto.subtle.digest('SHA-256',rgb));output.push({text:link.text,pixels:r.width*r.height,sha:[...hash].map(value=>value.toString(16).padStart(2,'0')).join('')})}return{origin,regions:output}
      })()`);return !pixels.waitingForFrame;
    },'link reference frame painted');
    assert.deepEqual(pixels.regions.map(row=>row.sha),expected.map(row=>row.rgbSha256),label+' actual screenshot caption pixels');
    return{label,links:actual.links.map(({text,color,button,canvas})=>({text,color,button,canvas})),...pixels,captureAttempts,pixelsCompared:pixels.regions.reduce((sum,row)=>sum+row.pixels,0),differentRgbPixels:0,wholeWidgetAccepted:false};
  }finally{
    await ui.evaluate("document.querySelectorAll('.taxi-element[data-kind=Button] > .taxi-button')[3].click()");await until(()=>JSON.stringify(view.selected)===JSON.stringify(selected),'link selection restored after screenshot');
  }
}
exports.run=()=>require('./form-button-types-host.cjs').run({sample});

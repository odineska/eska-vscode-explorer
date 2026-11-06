const {until}=require('./webview-host.cjs');

/** Set only the preview area's placement so the renderer sees the recorded native coordinates. */
async function matchFormRasterOrigin(ui,[x,y]) {
  await ui.evaluate(`(()=>{
    const viewport=document.querySelector('.preview-scroll');
    const shell=viewport.closest('.form-shell'),inspectors=shell.querySelector('.form-inspectors');
    document.body.style.paddingLeft='0px';
    shell.scrollLeft=shell.scrollTop=viewport.scrollLeft=viewport.scrollTop=0;
    const rect=document.querySelector('.taxi-form-frame').getBoundingClientRect();
    const style=getComputedStyle(viewport);
    viewport.style.marginLeft=(parseFloat(style.marginLeft)+${x}-rect.x)+'px';
    if(inspectors)inspectors.style.height=(inspectors.getBoundingClientRect().height+${y}-rect.y)+'px';
    else viewport.style.paddingTop=(parseFloat(style.paddingTop)+${y}-rect.y)+'px';
  })()`);
  await until(()=>ui.evaluate(`(()=>{
    const rect=document.querySelector('.taxi-form-frame').getBoundingClientRect();
    return rect.x===${x}&&rect.y===${y};
  })()`),'form is positioned at the measured native raster origin');
}
module.exports={matchFormRasterOrigin};

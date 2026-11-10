const assert=require('node:assert/strict');
const {runGallery}=require('./form-input-pixels-host.cjs');
exports.run=()=>runGallery({
  fixtureKey:'inputFonts',prefix:'input-fonts',dirtyFrom:'Font10Width20',dirtyTo:'Font32Width20',
  reportKey:'inputFonts',dirtyKey:'dirtyDimensions',verifyFrame:true,fullScreen:true,
  async checkFieldValues({ui,kind}){
    if(!kind.endsWith('Width1'))return;
    const overflow=await ui.evaluate(`(() => {
      const viewport=document.querySelector('.preview-scroll');
      return [viewport.scrollWidth-viewport.clientWidth,viewport.scrollHeight-viewport.clientHeight];
    })()`);
    assert.deepEqual(overflow,[0,0],kind+' input raster must fit the native viewport');
  }
});

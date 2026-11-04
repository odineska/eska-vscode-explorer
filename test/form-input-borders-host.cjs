const {runGallery}=require('./form-input-pixels-host.cjs');
exports.run=()=>runGallery({
  fixtureKey:'inputBorders',prefix:'input-borders',dirtyFrom:'FreshA',dirtyTo:'FreshB',
  reportKey:'inputBorders',dirtyKey:'dirtyPalette',verifyFrame:false
});

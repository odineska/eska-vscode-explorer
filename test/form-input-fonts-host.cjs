const {runGallery}=require('./form-input-pixels-host.cjs');
exports.run=()=>runGallery({
  fixtureKey:'inputFonts',prefix:'input-fonts',dirtyFrom:'Font10Width20',dirtyTo:'Font32Width20',
  reportKey:'inputFonts',dirtyKey:'dirtyDimensions',verifyFrame:true,fullScreen:true
});

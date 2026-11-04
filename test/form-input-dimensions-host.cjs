const {runGallery}=require('./form-input-pixels-host.cjs');
exports.run=()=>runGallery({
  fixtureKey:'inputDimensions',prefix:'input-dimensions',dirtyFrom:'WidthFont10Width20',dirtyTo:'WidthFont16Width40',
  reportKey:'inputDimensions',dirtyKey:'dirtyDimensions',verifyFrame:true
});

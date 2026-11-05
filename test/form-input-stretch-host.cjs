const {runGallery}=require('./form-input-pixels-host.cjs');
exports.run=()=>runGallery({
  fixtureKey:'inputStretch',prefix:'input-stretch',dirtyFrom:'DefaultAutoMin20Font10',dirtyTo:'StretchWidth20ConflictFont16',
  reportKey:'inputStretch',dirtyKey:'dirtyDimensions',verifyFrame:true
});

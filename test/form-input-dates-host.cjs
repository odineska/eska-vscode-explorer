const {runGallery}=require('./form-input-pixels-host.cjs');
exports.run=()=>runGallery({
  fixtureKey:'inputDates',prefix:'input-dates',reportKey:'inputDates',dirtyKey:'dirtyDates',
  dirtyCases:{Date10:'Time10',DateReadOnly10:'DateReadOnlyChoice10',Font4:'DateDisabled4',Font8Width20:'Font48Width20'},
  verifyFrame:true,fullScreen:true,verifyDates:true
});

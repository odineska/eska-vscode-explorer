const assert = require('node:assert/strict');
const { editFormSource, until } = require('./webview-host.cjs');
const {runGallery}=require('./form-input-pixels-host.cjs');

async function checkFieldValues({ui, view, document, kind}) {
  if (kind !== 'DateTime10') return;
  const original = document.getText();
  const editFormat = /<EditFormat>[\s\S]*?<\/EditFormat>/u;
  assert.match(original, editFormat);
  const value = () => ui.evaluate('document.querySelector(\'.taxi-input input[aria-label="When"]\')?.value');
  assert.equal(await value(), '  /  /       :  :   AM');
  await editFormSource(document, view, original.replace(editFormat, ''));
  await until(async () => await value() === '  /  /       :  :  ', 'unformatted date uses the 24-hour preview');
  const explicit = '<EditFormat><v8:item><v8:lang>ru</v8:lang><v8:content>ДФ="дд.ММ.гггг ЧЧ:мм"</v8:content></v8:item></EditFormat>';
  await editFormSource(document, view, original.replace(editFormat, explicit));
  await until(async () => await value() === '  .  .       :  ', 'dirty XML changes the date separators and omits seconds');
  await editFormSource(document, view, original);
  await until(async () => await value() === '  /  /       :  :   AM', 'an authored 12-hour mask remains available');
}

exports.run=()=>runGallery({
  fixtureKey:'inputDates',prefix:'input-dates',reportKey:'inputDates',dirtyKey:'dirtyDates',
  dirtyCases:{Date10:'Time10',DateReadOnly10:'DateReadOnlyChoice10',Font4:'DateDisabled4',Font8Width20:'Font48Width20'},
  verifyFrame:true,fullScreen:true,verifyDates:true,checkFieldValues
});

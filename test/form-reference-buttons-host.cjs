const { runGallery } = require('./form-input-pixels-host.cjs');

exports.run = () => runGallery({
  fixtureKey: 'referenceButtons', prefix: 'reference-buttons',
  dirtyFrom: 'CatalogButtons', dirtyTo: 'Decisions',
  reportKey: 'referenceButtons', dirtyKey: 'dirtyButtons', verifyFrame: true, fullScreen: true,
});

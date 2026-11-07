import {formReferenceRoot} from './form-references.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {standardPicture} from '../webview/forms/standard-pictures.mjs';

function compositeHash(image, matteAt) {
 const rgb = Buffer.alloc(16 * 16 * 3);
 for (let pixel = 0; pixel < 256; pixel++) {
  const matte = matteAt(Math.floor(pixel / 16)), alpha = image.rgba[pixel * 4 + 3];
  for (let channel = 0; channel < 3; channel++) {
   rgb[pixel * 3 + channel] = Math.round(image.rgba[pixel * 4 + channel] * alpha / 255)
    + Math.round(matte[channel] * (255 - alpha) / 255);
  }
 }
 return createHash('sha256').update(rgb).digest('hex');
}

test('standard pictures preserve native pixels on three mattes',async()=>{
 const matrix=JSON.parse(await readFile(new URL('tests/fixtures/forms/native-standard-pictures/metrics.json',formReferenceRoot)));let pixels=0;
 for(const row of matrix.rows)for(const expected of row.pictures){
  const image=standardPicture('StdPicture.'+expected.name);
  assert.deepEqual([image.width,image.height],[16,16]);
  assert.equal(compositeHash(image, () => row.matte),expected.rgbSha256,row.name+'/'+expected.name);pixels+=256;
 }
 for(const table of matrix.tableConsumers)for(const [locale,pictures]of Object.entries(table.locales))for(const expected of pictures){
  const image=standardPicture(expected.name);
  assert.equal(compositeHash(image, row => expected.backgroundRows[row]),expected.rgbSha256,locale+'/'+expected.name);
 }
 assert.equal(pixels,matrix.pixels);assert.equal(matrix.recovery.differingPixels,0);assert.equal(matrix.pixelTolerance,0);assert.deepEqual(matrix.comparisonMasks,[]);
 for(const name of ['Copy','Unknown','PrefixMoveUp','MoveUpSuffix',null])assert.equal(standardPicture(name),undefined);
 assert.equal(standardPicture('MoveUp','tableCommand'),undefined,'automatic table movement has a different native image');
 assert.deepEqual(standardPicture('Find'),standardPicture('SearchControl'));assert.notDeepEqual(standardPicture('CloneObject'),standardPicture('CloneListItem'));
});

test('the exchange-plan picture matches Linux Configurator on three mattes', () => {
 const image = standardPicture('StdPicture.ExchangePlan');
 assert.deepEqual([image.width, image.height], [16, 16]);
 for (const [matte, expected] of [
  [[255, 255, 255], 'd12622c367d2d62c224f1b813215ff17c20f65bb65e17889599250cc12cbb594'],
  [[0, 0, 0], '1e46c749c1ff45a837f2ccaa47d91fb5ed17e74ccd386aa6d1522c25f5c0a658'],
  [[255, 0, 0], '9eba85ddb1d441de8ef9bb8e841451b0fde41dfad1fec0aa2677281a2d85b1ee'],
 ]) {
  assert.equal(compositeHash(image, () => matte), expected);
 }
});

test('additional-menu pictures match the recorded white and selected Linux rows', () => {
 for (const [name, white, selected] of [
  ['PostAndClose', '4aa100412baed98331a3cf87fa964b454b0bcf06547b8b219fe5902b9ac827d4', 'b1acb1c90ca800d3b7e8800a3fbf130bce60afc449d56c7b980c46bc6cfcc7fe'],
  ['Write', 'cfb6a69bb8869f1e64b8c751fe034a22abdff0ebfc6d9004cbe14a966afb7de2'],
  ['MarkObjectForDeletion', '16b89a4e98e0bd8faae1c6193cc7853ac671d5daf5ada2b8e8a40b59902b225e', '8dd000bd08d1a3f3622a23363f8794d7d98972b5224a237618a1cd7d5672b443'],
  ['UndoPosting', 'faa8cd80aafd9445508e38e8e34d3d17f8c21aaca48484ad7a8339a9ea609f54', 'f785fcd9833678bb78ca81045cabc2011eaa71d0813c733485babeb2f454fab3'],
  ['ShowInList', '6fce299a2ecf68d6b0eadd8b5bb8bc2fc2d9d5ae5698269bc05c8bd673eec147', 'cfbdb208cbd94a4f929a8aac9eb75ee82491fb47976a23afd229e3bf86f190e2'],
  ['ChangeHistory', '70db1c221cbf9f11053692cf276951615bf7480e55f781ff23c4a4848c161030', 'cc6a696388f15b065d53523f2ac6105735abdc5a141084ba85aa23f0d6bb8382'],
  ['CustomizeForm', '343625ace762a677d58ed21abdb608b0432cb417abf92f8ab18dbe5f564f3847', '7841aa2ea3c481cc8b822c2a0cf9a3e49552acd7993190da9c72771809d474e0'],
  ['Help', '4ce995460c62e4d9b64b4b3b5aaf3053cc8c2cd8f5219f585bff168ee857e076'],
 ]) {
  const image = standardPicture(name);
  assert.deepEqual([image.width, image.height], [16, 16]);
  assert.equal(compositeHash(image, () => [255, 255, 255]), white, name + ' on white');
  if (selected) assert.equal(compositeHash(image, () => [250, 204, 31]), selected, name + ' on selection');
 }
});

test('dynamic-list menu pictures preserve native white and selected pixels', () => {
  const rows = [
    [
        "Create",
        "1102de4c5919fbce43b8e65a6c59d85efad605ca53fa3b520aff49387f6c9771",
        "8e834505d484baaa29421cbbf654e82b346efe914f488fb0bd36d9dc0ef014ff"
    ],
    [
        "Change",
        "aa44489cda7ea3aa6205eceb6b1ba7ee25b108b26fdf4e2b6add222f5adad269",
        "531ef173f84963f079fe2b864a63c7882e2ba0a7439f00a7c846f7f2e3805152"
    ],
    [
        "CancelSearch",
        "ef093e03ea900314e3ddc9905add2a12de1874ffd760ba5aaea27b355d400ec3",
        "50b02ba147803cbc87a8ef4c2674f70101f53d5ff6c8f1c8b5aec75ea268536f"
    ],
    [
        "ListSettings",
        "6760e977086370151d4529c8d05c12d926f3e28fe8b7693875f4acdda77713ab",
        "9fd6fa9f06677a08d5d6968ba39e4178f45e4b23fa2d1aef92b233e50e0b2608"
    ],
    [
        "SelectSettings",
        "e8e34ebfdb6ec1f6226f15af35b9c2c8c27477fcf3dc40aada3b553b3f2aac57",
        "22349e3780dbc682224cfa6b788a980df20069e136f6df600be909f56394c284"
    ],
    [
        "SaveSettings",
        "a9dca2431099fa23f80b9e6a708e83c1e0d7053f593bb849a1b76c56c019a9d9",
        "784ba18fc133e059221becd4166dd425d7cd7fd71212b58ff26e47733e1c2628"
    ],
    [
        "OutputList",
        "a93188f00e5bbb6ae268168b91b7799dc15cee2e65b6b1d5d41dfc38bdc3c5bc",
        "278c38065db296c8ae8c38b8e13caf47060f8ca02a321923d6ff86e700804bef"
    ],
    [
        "SetPeriod",
        "9713acdad13711a5e6acd3da26f9abbb1c673d4c1cb5b4d365d36b56576e7f37",
        "68f7abe063f885786292c6b677a8c93bd858f90d619e3f90d58829a9572f53c1"
    ],
    [
        "DeleteListItem",
        "7afb1fb763b70adddb1be4b9d99edca262123c9e33947670f540875d3f8d401f",
        "02e2372617a180d8320c8304284cf53439f224ff4162fc55189bda1b63b418fa"
    ],
    [
        "CreateFolder",
        "7f25465ba83b7145ef93382801b13c6e8d3d4a00758964e0165bd0d711dd5426",
        "a8600bbf7fa5bf75db48b36f9466d595c1d79952b22194a2ccc9277df9b50872"
    ],
    [
        "ViewMode",
        "fb1b7b332a172d46c57cd791a8e7788cdab7968002fdfd972aefc7283837ab85",
        "baace1cbe5817f990eac1cf55ede52e0b35ac00310ea5775490ac3f1b97eb24f"
    ],
    [
        "MoveItem",
        "54125858fc04416ef812ca4b086c4120710c82a574269527a0b38d91d42f4ae6",
        "dedf56e2edf270fe69ded79edd67e8ace87e88553fc7014324603d41f6841baf"
    ],
    [
        "LevelDown",
        "1806b5bf4e3382521d9ccf14ada8abf8704f42a088a9e33bc05eada306fa74ca",
        "1c1e607803779fcc95197b04b33aa28a543d5f143310d9e1e4693c7067d44534"
    ],
    [
        "LevelUp",
        "375a9c1792a2fb7d3cb6f7136392f84afcaa8d50014f9003ee8a6a221ea94ff8",
        "3896532a183a063495e3dad0bd6077c104b02de89d791c19a1d28d558d5ea1c2"
    ],
    [
        "HierarchicalList",
        "7a34286c50ec716272b0deda2d44e6cfb9fc23a4725fec754cb64ab611f511bc",
        "d8d492f0ebaad8e48c1c198e2f18bc21e5ad3d22cafa1614b97d5715f95aaf7b"
    ],
    [
        "List",
        "1b3a00cfe580899551766b2af750a966b1602aa415fa9b115eabf3f2e2b15cc2",
        "68f2da8778a8bcf2eae1b4bea7be2c7eb23c55d339a6459fadab27571020ef05"
    ],
    [
        "Tree",
        "d8a24075736be746beeb5144ccd205a9208ca40206490f7303af4d37afff3f10",
        "889d54b5727af4cfe5116ad9456ee2e8e9bd3a080d5a505e66159a43f502d455"
    ]
];
  for (const [name, white, selected] of rows) {
    const image = standardPicture(name);
    assert.equal(compositeHash(image, () => [255,255,255]), white, name + ' white');
    assert.equal(compositeHash(image, () => [250,204,31]), selected, name + ' selected');
  }
});

test('the link template follows the menu foreground and preserves recorded coverage', () => {
  const image = standardPicture('GetCurrentRowURL');
  assert.equal(image.isTemplate, true);
  const hash = (foreground, matte) => {
    const rgb = Buffer.alloc(16*16*3);
    for (let pixel=0; pixel<256; pixel++) {
      const alpha = image.rgba[pixel*4+3];
      for (let channel=0; channel<3; channel++)
        rgb[pixel*3+channel] = Math.round(foreground*alpha/255 + matte[channel]*(255-alpha)/255);
    }
    return createHash('sha256').update(rgb).digest('hex');
  };
  assert.equal(hash(77,[255,255,255]), "962baa6b744e0dcfaefb9c7f9308db0b827a47f27d714a3514458379eb8e399a");
  assert.equal(hash(61,[250,204,31]), "030fa6fd60fa536c345e0e215d56fa10c2264d3f9a818f6718a913bd216446be");
});

test('list menus retain their context-specific native picture variants', () => {
  const rows = [
    [
        "MarkObjectForDeletion",
        "38a6f4dfa30c5a2d1d7c49770c1bf4fefb307f5c13bab56d45ae91eb2c80b887",
        "2afbd13ab99dcd48c464fabddf37b7027704210b32a01f3c64f245eb842cb24f"
    ],
    [
        "DeleteListItemDirectly",
        "afd3a55251ae9eb527a798d67ff161ed85811f35daeafc98f77a509b2aab904f",
        "fb3012f25b211bef28d36b3be1a2735351fdecfcb4171304adaf7a122f98bd6b"
    ],
    [
        "Refresh",
        "d79f637ed58e1577504c74e111ec0f1d883e8974f5630cfddcbd7aa83d181a8a",
        "0fdca571562c165d9dc64fb72b331c5068175e1c5a612ea6d025d3f4eec44c9c"
    ],
    [
        "Find",
        "da08de9b28915cd2ef5d74edd0b70f9a3b5c83340d826cee6da7f8643f921710",
        "3b2dcce4e083abc33e9055902e329ddff32ed6eee4a9bb7869bc2e2997cbefd3"
    ],
    [
        "Post",
        "1fc9103b0f62bf663b4efd0db42908a85d9c675e0b91381d55efd632ec28db74",
        "32a25d60937860c2b399d9d9c18dbf45ca8f4b93d1a3a131cdb2db5b264fa765"
    ]
];
  for (const [name, white, selected] of rows) {
    const image=standardPicture(name,'tableMenu');
    assert.equal(compositeHash(image,()=>[255,255,255]),white,name+' white');
    assert.equal(compositeHash(image,()=>[250,204,31]),selected,name+' selected');
    assert.notDeepEqual(image,standardPicture(name),name+' has a separate menu image');
  }
});

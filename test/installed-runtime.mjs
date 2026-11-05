import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { fromBuffer } from 'yauzl';

export const digest = value => createHash('sha256').update(value).digest('hex');
export function harnessFailure(code, context = {}) { return Object.assign(new Error(code), {code,category:'harness',context}); }

/** Verify actual packaged runtime bytes, including the form renderer, fonts and WASM. */
export async function verifyRuntime(vsix, {checkout,installed,forms = false} = {}) {
  const data = Buffer.isBuffer(vsix) ? vsix : await readFile(vsix);
  if (data.length > 512 * 1024 * 1024) throw harnessFailure('vsix_size');
  const zip = await new Promise((resolve,reject) => fromBuffer(data,{lazyEntries:true,autoClose:false,strictFileNames:true},(error,zip) => error ? reject(error) : resolve(zip)));
  const files = [], names = new Set(); let unpacked = 0;
  try {
    await new Promise((resolve,reject) => {
      zip.once('error',reject); zip.once('end',resolve);
      zip.on('entry',entry => { (async () => {
        if (!entry.fileName.endsWith('/') && /^extension\/(?:out|resources)\//.test(entry.fileName)) {
          const path = entry.fileName.slice('extension/'.length), key = path.toLowerCase();
          if (path.includes('\\') || path.includes(':') || path.split('/').includes('..') || names.has(key)
              || ![0,8].includes(entry.compressionMethod) || entry.generalPurposeBitFlag & 1) throw harnessFailure('vsix_runtime_entry',{path});
          unpacked += entry.uncompressedSize;
          if (unpacked > 128 * 1024 * 1024 || names.size > 16384) throw harnessFailure('vsix_runtime_size');
          names.add(key);
          const stream = await new Promise((resolve,reject) => zip.openReadStream(entry,(error,input) => error ? reject(error) : resolve(input)));
          const chunks = []; for await (const chunk of stream) chunks.push(chunk);
          const bytes = Buffer.concat(chunks), sha256 = digest(bytes);
          for (const [kind,root] of [['checkout',checkout],['installed',installed]]) if (root) {
            const actual = await readFile(join(root,path)).catch(() => { throw harnessFailure('runtime_asset_missing',{kind,path}); });
            if (digest(actual) !== sha256) throw harnessFailure('runtime_asset_mismatch',{kind,path,expected:sha256,actual:digest(actual)});
          }
          files.push({path,size:bytes.length,sha256});
        }
        zip.readEntry();
      })().catch(reject); });
      zip.readEntry();
    });
  } finally { zip.close(); }
  const required = ['out/extension.js','resources/properties/view.js',...(forms ? ['out/form-preview.js','out/form-preview.css'] : [])];
  if (required.some(path => !names.has(path.toLowerCase())) || forms && (!files.some(file => /^out\/form-fonts\/.*\.wasm$/.test(file.path)) || !files.some(file => /^out\/form-fonts\/.*\.ttf$/.test(file.path)))) throw harnessFailure('vsix_runtime_missing');
  files.sort((a,b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  return {vsixSha256:digest(data),manifestSha256:digest(JSON.stringify(files)),files};
}

import { build } from "esbuild";
import { transformAsync } from "@babel/core";
import solid from "@solidjs/babel-plugin";
import { readFile, readdir, writeFile, rm } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { createHash } from "node:crypto";

const raster = JSON.parse(await readFile("resources/forms/native-text/manifest.json", "utf8"));
for (const [file, expected] of [["scripts/form-font-raster.c", raster.bridgeSha256], ["resources/forms/native-text/font-raster.wasm", raster.wasmSha256]]) {
  if (createHash("sha256").update(await readFile(file)).digest("hex") !== expected) throw new Error(`Stale caption rasterizer: ${file}`);
}

const bundleOptions = { bundle: true, metafile: true, legalComments: "inline", minifyWhitespace: true, minifySyntax: true };
// The installed VSIX must never resolve runtime dependencies from the development checkout.
const result = await build({ ...bundleOptions, entryPoints: ["src/extension.ts"], outfile: "out/extension.js",
  // Keep function and class names available in extension-host stack traces.
  minifyIdentifiers: true, keepNames: true,
  platform: "node", target: "node22", format: "cjs", external: ["vscode"] });
const browserOptions = { ...bundleOptions, outdir: "out", minifyIdentifiers: true,
  platform: "browser", target: "chrome140", format: "iife",
  loader: { ".ttf": "file", ".wasm": "file" }, assetNames: "form-fonts/[name]-[hash]",
  conditions: ["browser", "production"], define: { "process.env.NODE_ENV": '"production"' },
  plugins: [{ name: "solid-jsx", setup(builder) {
    builder.onLoad({ filter: /\.jsx$/ }, async args => {
      const result = await transformAsync(await readFile(args.path, "utf8"), { filename: args.path,
        plugins: [[solid, { generate: "dom", hydratable: false }]], babelrc: false, configFile: false });
      if (!result?.code) throw new Error(`Cannot compile Solid component: ${args.path}`);
      return { contents: result.code, loader: "js" };
    });
  } }]
};
const [query, form, settings, scm] = await Promise.all([
  build({ ...browserOptions, entryPoints: { "query-designer": "webview/query/index.jsx" } }),
  build({ ...browserOptions, entryPoints: { "form-preview": "webview/forms/index.jsx" } }),
  build({ ...browserOptions, entryPoints: { "project-settings": "webview/settings/index.jsx" } }),
  build({ ...browserOptions, entryPoints: { "scm-view": "webview/scm/index.jsx" } }),
]);
const browser = {
  inputs: { ...query.metafile.inputs, ...form.metafile.inputs, ...settings.metafile.inputs, ...scm.metafile.inputs },
  outputs: { ...query.metafile.outputs, ...form.metafile.outputs, ...settings.metafile.outputs, ...scm.metafile.outputs },
};
// Asset names include hashes; an incremental build must not package older font engines.
const assets = new Set(Object.keys(browser.outputs).map(file => resolve(file)));
for (const file of await readdir("out/form-fonts")) {
  const path = join("out/form-fonts", file);
  if (/\.(?:ttf|wasm)$/.test(file) && !assets.has(resolve(path))) await rm(path);
}
const packages = new Map();
for (const input of Object.keys({ ...result.metafile.inputs, ...browser.inputs }).filter(path => path.includes("node_modules/"))) {
  let folder = dirname(resolve(input));
  let found = false;
  while (folder !== dirname(folder)) {
    const metadata = await readFile(join(folder, "package.json"), "utf8").catch(() => undefined);
    if (metadata) {
      const value = JSON.parse(metadata);
      if (typeof value.name === "string" && typeof value.version === "string") {
        packages.set(`${value.name}@${value.version}`, { folder, value }); found = true; break;
      }
    }
    if (basename(folder) === "node_modules") break;
    folder = dirname(folder);
  }
  if (!found) throw new Error(`Missing bundled dependency metadata: ${input}`);
}
const notices = [];
notices.push(`Liberation Fonts 2.1.5 (SIL Open Font License 1.1)\n${"=".repeat(72)}\n${await readFile("resources/forms/fonts/LICENSE", "utf8")}\n`);
notices.push(await readFile("resources/forms/native-text/NOTICES.txt", "utf8"));
notices.push(await readFile("resources/forms/native-paint/NOTICES.txt", "utf8"));
notices.push(await readFile("resources/forms/jet/NOTICE.md", "utf8"));
notices.push(await readFile("resources/forms/jet/LICENSE-MIT", "utf8"));
for (const [name, { folder, value }] of [...packages].sort(([a], [b]) => a.localeCompare(b, "en"))) {
  const files = (await readdir(folder)).filter(file => /^(licen[cs]e|copying|notice)(\.|$)/i.test(file)).sort();
  notices.push(`${name} (${value.license ?? "see license"})\n${"=".repeat(72)}\n`);
  if (!files.length) {
    // These tarballs omit the MIT text from their shared publication commit.
    // https://github.com/solidjs/solid/blob/82f71fddb1340cab46167db119da5702038e65ab/LICENSE
    if (value.license !== "MIT" || !["solid-js@2.0.1", "@solidjs/web@2.0.1"].includes(name)) {
      throw new Error(`Missing bundled dependency license: ${name}`);
    }
    notices.push(`LICENSE\n${await readFile("scripts/licenses/solid-2.0.1.txt", "utf8")}\n`);
  }
  for (const file of files) notices.push(`${file}\n${await readFile(join(folder, file), "utf8")}\n`);
}
await writeFile("out/THIRD-PARTY-NOTICES.txt", notices.join("\n"));
await writeFile("out/extension-meta.json", JSON.stringify(result.metafile, null, 2) + "\n");

await writeFile("out/query-designer-meta.json", JSON.stringify(browser, null, 2) + "\n");

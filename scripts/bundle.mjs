import { build } from "esbuild";
import { transformAsync } from "@babel/core";
import solid from "babel-preset-solid";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

// The installed VSIX must never resolve runtime dependencies from the development checkout.
const result = await build({ entryPoints: ["src/extension.ts"], outfile: "out/extension.js", bundle: true,
  platform: "node", target: "node22", format: "cjs", external: ["vscode"], metafile: true, legalComments: "inline" });
const browser = await build({ entryPoints: { "query-designer": "webview/query/index.jsx", "form-preview": "webview/forms/index.jsx" }, outdir: "out", bundle: true,
  platform: "browser", target: "chrome140", format: "iife", metafile: true, legalComments: "inline",
  loader: { ".ttf": "file" }, assetNames: "form-fonts/[name]-[hash]",
  conditions: ["browser", "production"], define: { "process.env.NODE_ENV": '"production"' },
  plugins: [{ name: "solid-jsx", setup(builder) {
    builder.onLoad({ filter: /\.jsx$/ }, async args => {
      const result = await transformAsync(await readFile(args.path, "utf8"), { filename: args.path,
        presets: [[solid, { generate: "dom", hydratable: false }]], babelrc: false, configFile: false });
      if (!result?.code) throw new Error(`Cannot compile Solid component: ${args.path}`);
      return { contents: result.code, loader: "js" };
    });
  } }]
});
const packages = new Map();
for (const input of Object.keys({ ...result.metafile.inputs, ...browser.metafile.inputs }).filter(path => path.includes("node_modules/"))) {
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
for (const [name, { folder, value }] of [...packages].sort(([a], [b]) => a.localeCompare(b, "en"))) {
  const files = (await readdir(folder)).filter(file => /^(licen[cs]e|copying|notice)(\.|$)/i.test(file)).sort();
  if (!files.length) throw new Error(`Missing bundled dependency license: ${name}`);
  notices.push(`${name} (${value.license ?? "see license"})\n${"=".repeat(72)}\n`);
  for (const file of files) notices.push(`${file}\n${await readFile(join(folder, file), "utf8")}\n`);
}
await writeFile("out/THIRD-PARTY-NOTICES.txt", notices.join("\n"));
await writeFile("out/extension-meta.json", JSON.stringify(result.metafile, null, 2) + "\n");

await writeFile("out/query-designer-meta.json", JSON.stringify(browser.metafile, null, 2) + "\n");

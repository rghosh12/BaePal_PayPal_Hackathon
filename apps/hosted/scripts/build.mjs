import { build } from "esbuild";
import { readFile, mkdir, readdir, cp } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
const root = fileURLToPath(new URL("../", import.meta.url));
const bundle = await build({
  entryPoints: [root + "src/client.tsx"],
  bundle: true,
  write: false,
  format: "esm",
  platform: "browser",
  minify: true,
  jsx: "automatic",
  target: "es2022",
  alias: {
    "next/link": root + "src/shims/link.tsx",
    "next/navigation": root + "src/shims/navigation.ts",
  },
  define: { "process.env.NODE_ENV": '"production"' },
});
const client = bundle.outputFiles[0].text,
  css = await readFile(root + "src/ui/globals.css", "utf8");
const hash = (value) =>
  createHash("sha256").update(value).digest("hex").slice(0, 12);
const scriptPath = `/assets/app-${hash(client)}.js`,
  cssPath = `/assets/app-${hash(css)}.css`;
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><meta name="description" content="BaePal private prototype. Intentional connections, thoughtful first dates, fictional people and mock payments."><title>BaePal · Your private prototype</title><link rel="stylesheet" href="${cssPath}"></head><body><div id="root"><main class="auth-card"><h1>BaePal</h1><p>A good connection deserves a good first date.</p><p>Opening your private prototype…</p></main></div><script type="module" src="${scriptPath}"></script></body></html>`;
const portraits = {};
for (const name of await readdir(root + "public/portraits"))
  portraits["/portraits/" + name] = await readFile(
    root + "public/portraits/" + name,
    "utf8",
  );
await mkdir(root + "dist/server", { recursive: true });
await mkdir(root + "dist/.openai", { recursive: true });
await build({
  entryPoints: [root + "src/worker.ts"],
  outfile: root + "dist/server/index.js",
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  minify: true,
  plugins: [
    {
      name: "embedded-assets",
      setup(builder) {
        builder.onResolve({ filter: /^baepal:assets$/ }, () => ({
          path: "assets",
          namespace: "embedded",
        }));
        builder.onLoad({ filter: /.*/, namespace: "embedded" }, () => ({
          contents: Object.entries({
            html,
            css,
            client,
            scriptPath,
            cssPath,
            portraits,
          })
            .map(([k, v]) => `export const ${k}=${JSON.stringify(v)};`)
            .join("\n"),
          loader: "js",
        }));
      },
    },
  ],
});
await cp(root + ".openai/hosting.json", root + "dist/.openai/hosting.json");
await cp(root + "drizzle", root + "dist/drizzle", { recursive: true });
console.log(
  "Built self-contained BaePal Worker, original UI/assets and schema-only D1 migrations.",
);

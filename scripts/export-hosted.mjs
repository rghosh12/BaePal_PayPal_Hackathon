import { cp, readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
const target = resolve(process.argv[2] || "/workspace/sites/baepal-prototype");
const source = resolve(root, "apps/hosted");
if (target === source || source.startsWith(target + sep))
  throw Error("Choose a separate export directory.");
const manifest = JSON.parse(
  await readFile(source + "/.openai/hosting.json", "utf8"),
);
try {
  const existing = JSON.parse(
    await readFile(target + "/.openai/hosting.json", "utf8"),
  );
  if (existing.project_id !== manifest.project_id)
    throw Error("Refusing to overwrite a different Site identity.");
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
await mkdir(target, { recursive: true });
await cp(source, target, {
  recursive: true,
  filter: (path) =>
    !path
      .slice(source.length)
      .split(sep)
      .some(
        (p) =>
          ["node_modules", "dist", ".git", ".data", ".env"].includes(p) ||
          p.endsWith(".tsbuildinfo"),
      ),
});
await cp(root + "LICENSE", target + "/LICENSE");
const tsconfig = JSON.parse(await readFile(target + "/tsconfig.json", "utf8"));
delete tsconfig.extends;
Object.assign(tsconfig.compilerOptions, {
  target: "ES2022",
  lib: ["ES2022", "DOM"],
  strict: true,
  esModuleInterop: true,
  skipLibCheck: true,
  noEmit: true,
});
await writeFile(
  target + "/tsconfig.json",
  JSON.stringify(tsconfig, null, 2) + "\n",
);
const pkg = JSON.parse(await readFile(target + "/package.json", "utf8"));
pkg.packageManager = "pnpm@11.25.0";
Object.assign(pkg.devDependencies, {
  typescript: "5.9.3",
  "@types/node": "24.10.1",
});
await writeFile(target + "/package.json", JSON.stringify(pkg, null, 2) + "\n");
await writeFile(
  target + "/.gitignore",
  "node_modules/\ndist/\n.env*\n.dev.vars*\n.wrangler/\n.sites-runtime/\n*.tsbuildinfo\n",
);
await writeFile(
  target + "/pnpm-workspace.yaml",
  "packages: []\nverifyDepsBeforeRun: false\nallowBuilds:\n  esbuild: true\n",
);
console.log(
  "Prepared standalone Sites source at " +
    target +
    "; existing Git metadata and Site identity preserved.",
);

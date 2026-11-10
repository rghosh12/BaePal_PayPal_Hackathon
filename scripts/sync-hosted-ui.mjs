import { copyFile, mkdir, readdir } from "node:fs/promises";
const root = new URL("../", import.meta.url);
await mkdir(new URL("apps/hosted/src/ui/", root), { recursive: true });
await copyFile(
  new URL("apps/web/src/components/BaePal.tsx", root),
  new URL("apps/hosted/src/ui/BaePal.tsx", root),
);
await copyFile(
  new URL("apps/web/src/app/globals.css", root),
  new URL("apps/hosted/src/ui/globals.css", root),
);
await mkdir(new URL("apps/hosted/public/portraits/", root), {
  recursive: true,
});
for (const name of await readdir(new URL("apps/web/public/portraits/", root)))
  await copyFile(
    new URL("apps/web/public/portraits/" + name, root),
    new URL("apps/hosted/public/portraits/" + name, root),
  );
console.log(
  "Synced original BaePal interface and illustrations into the hosted app.",
);

await copyFile(
  new URL("apps/web/src/components/TasteWorkspace.tsx", root),
  new URL("apps/hosted/src/ui/TasteWorkspace.tsx", root),
);

await copyFile(
  new URL("apps/web/src/components/MatchWhy.tsx", root),
  new URL("apps/hosted/src/ui/MatchWhy.tsx", root),
);

await copyFile(
  new URL("apps/web/src/components/IntegrationWorkspace.tsx", root),
  new URL("apps/hosted/src/ui/IntegrationWorkspace.tsx", root),
);

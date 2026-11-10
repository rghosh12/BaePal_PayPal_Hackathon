import { readdir, readFile } from "node:fs/promises";
import { db, tx } from "./db.js";
export async function migrate() {
  await db.query(
    "CREATE TABLE IF NOT EXISTS schema_migrations(name text PRIMARY KEY, applied_at timestamptz DEFAULT now())",
  );
  const dir = new URL("../../../db/migrations/", import.meta.url);
  for (const name of (await readdir(dir))
    .filter((n) => n.endsWith(".sql"))
    .sort()) {
    await tx(async (c) => {
      await c.query("SELECT pg_advisory_xact_lock(489231)");
      if (
        !(
          await c.query("SELECT 1 FROM schema_migrations WHERE name=$1", [name])
        ).rowCount
      ) {
        await c.query(await readFile(new URL(name, dir), "utf8"));
        await c.query("INSERT INTO schema_migrations(name) VALUES($1)", [name]);
        console.log(`Applied ${name}`);
      }
    });
  }
}
if (
  process.argv[1]?.endsWith("migrate.ts") ||
  process.argv[1]?.endsWith("migrate.js")
) {
  await migrate();
  await db.end();
}

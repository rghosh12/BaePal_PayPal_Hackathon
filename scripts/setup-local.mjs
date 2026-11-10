import { readFile, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
try {
  await readFile(new URL("../.env", import.meta.url));
  console.log(".env already exists; preserved.");
} catch (error) {
  if (error.code !== "ENOENT") throw error;
  const example = await readFile(
    new URL("../.env.example", import.meta.url),
    "utf8",
  );
  await writeFile(
    new URL("../.env", import.meta.url),
    example
      .replace(
        "replace_with_at_least_32_random_characters",
        randomBytes(32).toString("hex"),
      )
      .replace(
        "replace_with_64_hex_characters",
        randomBytes(32).toString("hex"),
      ),
    { mode: 0o600 },
  );
  console.log("Created local-only .env with fresh random keys.");
}

import pg from "pg";
import { config } from "./config.js";
export const db = new pg.Pool({
  connectionString: config.DATABASE_URL,
  max: 12,
});
export type Conn = pg.PoolClient;
export async function tx<T>(fn: (c: Conn) => Promise<T>): Promise<T> {
  const c = await db.connect();
  try {
    await c.query("BEGIN");
    const result = await fn(c);
    await c.query("COMMIT");
    return result;
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}
export async function one(
  c: Conn | pg.Pool,
  sql: string,
  args: unknown[] = [],
) {
  return (await c.query(sql, args)).rows[0];
}

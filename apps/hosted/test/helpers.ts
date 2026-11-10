import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { handleAPI } from "../src/api";
import type { Env } from "../src/types";
const origin = "https://baepal.test";
export function fixture() {
  const db = new DatabaseSync(":memory:");
  db.exec(
    "CREATE TABLE prototype_workspaces(id TEXT PRIMARY KEY,version INTEGER NOT NULL DEFAULT 0,state TEXT NOT NULL,updated_at TEXT NOT NULL)",
  );
  const env: Env = {
    FIELD_ENCRYPTION_KEY: "ab".repeat(32),
    DB: {
      prepare(sql) {
        let values: unknown[] = [];
        const statement = {
          bind(...args: unknown[]) {
            values = args;
            return statement;
          },
          async first<T>() {
            return (db.prepare(sql).get(...(values as any[])) ||
              null) as T | null;
          },
          async all<T>() {
            return {
              results: db.prepare(sql).all(...(values as any[])) as T[],
            };
          },
          async run() {
            const result = db.prepare(sql).run(...(values as any[]));
            return { meta: { changes: Number(result.changes) } };
          },
        };
        return statement;
      },
    },
  };
  const sessions: Record<string, { cookie: string; csrf: string }> = {};
  async function request(
    actor: string | null,
    method: string,
    path: string,
    body?: unknown,
    owner = "owner-one",
    headers: Record<string, string> = {},
  ) {
    return handleAPI(
      new Request(origin + "/api/v1" + path, {
        method,
        headers: {
          "oai-authenticated-user-id": owner,
          Origin: origin,
          "Content-Type": "application/json",
          ...(actor ? sessions[actor] : {}),
          ...(actor ? { "x-csrf-token": sessions[actor].csrf } : {}),
          ...headers,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
      env,
    );
  }
  async function data(
    actor: string | null,
    method: string,
    path: string,
    body?: unknown,
  ) {
    const r = await request(actor, method, path, body);
    const response = (await r.json()) as any;
    assert.equal(r.status, 200, JSON.stringify(response));
    return response.data;
  }
  async function login(name: string) {
    const r = await request(null, "POST", "/auth/login", {
      email: name.toLowerCase() + "@demo.baepal.invalid",
    });
    const value = (await r.json()) as any;
    sessions[name] = {
      cookie: r.headers.get("set-cookie")!.split(";")[0],
      csrf: value.data.csrf,
    };
    return data(name, "GET", "/me");
  }
  return { db, env, request, data, login, sessions };
}

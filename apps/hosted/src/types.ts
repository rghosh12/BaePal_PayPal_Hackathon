import type { TasteState } from "./taste";
export type Row = Record<string, any>;
export interface Statement {
  bind(...values: unknown[]): Statement;
  first<T = Row>(): Promise<T | null>;
  run(): Promise<{ meta: { changes: number } }>;
  all<T = Row>(): Promise<{ results: T[] }>;
}
export interface Env {
  DB: { prepare(sql: string): Statement };
  FIELD_ENCRYPTION_KEY: string;
  BAEPAL_INTEGRATIONS_JSON?: string;
}
export type State = {
  users: Row[];
  decisions: Row[];
  matches: Row[];
  messages: Row[];
  plans: Row[];
  purchases: Row[];
  payments: Row[];
  reports: Row[];
  taste?: Record<string, TasteState>;
  rates: Record<string, { count: number; until: number }>;
};

import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
export const prototypeWorkspaces = sqliteTable("prototype_workspaces", {
  id: text("id").primaryKey(),
  version: integer("version").notNull().default(0),
  state: text("state").notNull(),
  updatedAt: text("updated_at").notNull(),
});

import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { expect, it } from "vitest";

// The tests describe a throwaway in-memory table; the app itself never uses SQLite.
const scratch = sqliteTable("scratch", { id: integer("id").primaryKey(), name: text("name") });

it("defines a scratch table", () => {
  expect(scratch).toBeDefined();
});

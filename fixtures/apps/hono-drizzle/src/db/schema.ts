import { integer, pgTable, serial, text } from "drizzle-orm/pg-core";
// An earlier draft used MySQL tables:
// import { mysqlTable } from "drizzle-orm/mysql-core";

export const items = pgTable("items", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  quantity: integer("quantity").notNull().default(0),
});

import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { db } from "./db";
import { items } from "./db/schema";

const app = new Hono();

app.get("/items/:id", async (c) => {
  const [item] = await db.select().from(items).where(eq(items.id, Number(c.req.param("id"))));
  return item ? c.json(item) : c.notFound();
});

export default app;

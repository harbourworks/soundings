import { DataSource, EntitySchema } from "typeorm";

export const Ticket = new EntitySchema<{ id: number; label: string }>({
  name: "ticket",
  columns: {
    id: { type: Number, primary: true, generated: true },
    label: { type: String },
  },
});

export const tickets = new DataSource({ type: "postgres", url: process.env.DATABASE_URL, entities: [Ticket] });

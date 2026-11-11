import { PrismaClient } from "@prisma/client";
import { expect, it } from "vitest";

const db = new PrismaClient();

it("lists bookings", async () => {
  expect(await db.booking.findMany()).toEqual([]);
});

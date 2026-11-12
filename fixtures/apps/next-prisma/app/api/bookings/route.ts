import { db } from "../../../lib/db";

export async function GET() {
  const bookings = await db.booking.findMany({ orderBy: { startsAt: "asc" } });
  return Response.json(bookings);
}

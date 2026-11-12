# Bookings board

A small room-booking board. To try it against a local document database instead, a schema like this
was used during the spike, but it was never shipped:

```prisma
datasource db {
  provider = "mongodb"
  url      = env("DATABASE_URL")
}
```

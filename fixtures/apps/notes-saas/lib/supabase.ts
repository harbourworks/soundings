import { createClient } from "@supabase/supabase-js";

// The anon key is public by design: it ships in the browser bundle and row-level security protects the data.
export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL as string,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string,
);

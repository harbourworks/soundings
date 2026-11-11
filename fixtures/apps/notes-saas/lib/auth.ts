import { supabase } from "./supabase";

export function signIn(email: string, password: string) {
  return supabase.auth.signInWithPassword({ email, password });
}

import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.warn(
    "[supabase] SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set — " +
    "session storage will fail until these are configured in .env"
  );
}

export const supabase = createClient(url || "", key || "", {
  auth: { persistSession: false },
});

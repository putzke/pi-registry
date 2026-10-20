// Supabase Edge Function: the Outreach log's link reader (DEV link test first).
// All the logic is in logic.mjs (shared with the test harness, which runs it
// under Node). Deployed with JWT verification OFF so the browser's CORS
// preflight reaches it; every request then has to carry a signed-in session
// whose email is on pi_staff, checked inside.
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by Supabase.
import { createHandler } from './logic.mjs';

Deno.serve(createHandler({ env: Deno.env.toObject(), fetchFn: fetch }));

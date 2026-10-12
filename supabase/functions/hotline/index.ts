// Supabase Edge Function: the project hotline receiver.
// All the logic is in logic.mjs (shared with the test harness, which runs it
// under Node). Deployed with JWT verification OFF — Twilio cannot send a
// Supabase token — and every Twilio request is checked against Twilio's own
// signature instead. The app-facing routes (/notify, /callback, /dial) check
// the caller's Supabase session and the staff list themselves.
//
// Secrets (Supabase → Edge Functions → Secrets), per project:
//   TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN   required before any call is accepted
//   RESEND_API_KEY                          optional — new-voicemail emails
//   HOTLINE_FROM_EMAIL                      optional — default no-reply@cirruscc.com
//   APP_BASE_URL                            optional — the link in those emails
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by Supabase.
import { createHandler } from './logic.mjs';

Deno.serve(createHandler({ env: Deno.env.toObject(), fetchFn: fetch }));

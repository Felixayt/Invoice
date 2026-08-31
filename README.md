# Nudge

Invoicing software for solo service businesses. Create an invoice, set a due
date, and Nudge chases the client by email until it's marked paid.

Stack: Vite + React + TypeScript, Supabase (Auth, Postgres, Edge Functions),
deployed to Netlify.

## Local setup

```bash
npm install
cp .env.example .env
# fill in VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY from your Supabase
# project settings
npm run dev
```

## Supabase setup

1. Create a Supabase project.
2. Apply the migration in `supabase/migrations/0001_init.sql`.
3. Grant yourself the admin role once you have an account:
   ```sql
   update profiles set role = 'admin' where id = '<your-user-uuid>';
   ```
4. Deploy the reminder function and set its secrets:
   ```bash
   supabase functions deploy send-reminders
   supabase secrets set RESEND_API_KEY=... REMINDER_FROM_EMAIL="Nudge <reminders@yourdomain.com>"
   ```
5. Schedule the daily reminder sweep with `pg_cron` + `pg_net`, using Vault
   so the service role key is never stored in a migration file:
   ```sql
   create extension if not exists pg_cron;
   create extension if not exists pg_net;

   select vault.create_secret('<your-service-role-key>', 'service_role_key');

   select cron.schedule(
     'send-reminders-daily',
     '0 8 * * *', -- 08:00 UTC
     $$
     select net.http_post(
       url := 'https://<project-ref>.supabase.co/functions/v1/send-reminders',
       headers := jsonb_build_object(
         'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key'),
         'Content-Type', 'application/json'
       ),
       body := '{}'::jsonb
     );
     $$
   );
   ```
6. Run `get_advisors` (or check the Supabase dashboard's Advisors page) to
   confirm RLS is enabled on every table before going live.

## Environment variables

| Variable | Where | Purpose |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | Netlify | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Netlify | Supabase anon key |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Supabase Edge Function secrets (auto-provided) | DB access for the reminder function |
| `RESEND_API_KEY` | Supabase Edge Function secret | Sends reminder emails |
| `REMINDER_FROM_EMAIL` | Supabase Edge Function secret | From address for reminder emails |

None of these are committed to the repository.

## Milestone 1 scope

Auth, clients, invoices, dashboard with mark-as-paid, and the daily
pre-due/overdue reminder emails. Logo/branding, PDF generation, and the
admin screen are deferred to a later milestone.

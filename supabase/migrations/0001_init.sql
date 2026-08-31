-- Nudge: Milestone 1 schema
-- profiles, clients, invoices, reminder_log + RLS.
--
-- Reminders are not stored as scheduled/cancellable rows. The daily
-- send-reminders Edge Function computes who is due by querying
-- invoices.due_date directly, and reminder_log only records what was
-- actually sent (see FR-006/FR-007/FR-009 in the spec: "cancelling" a
-- reminder on mark-paid is implicit because paid invoices stop matching
-- the query BR-001 already requires).

create type user_role as enum ('owner', 'admin');
create type invoice_status as enum ('unpaid', 'paid');
create type reminder_type as enum ('pre_due', 'overdue');

create table profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  business_name text,
  logo_url text,
  role user_role not null default 'owner'
);

create table clients (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references profiles (id) on delete cascade,
  name text not null,
  email text not null,
  phone text,
  created_at timestamptz not null default now(),
  unique (owner_id, email)
);

create table invoices (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references profiles (id) on delete cascade,
  -- BR-005: a client with invoices cannot be deleted.
  client_id uuid not null references clients (id) on delete restrict,
  description text not null,
  amount numeric(10, 2) not null check (amount > 0), -- BR-006
  due_date date not null,
  status invoice_status not null default 'unpaid',
  created_at timestamptz not null default now(),
  paid_at timestamptz
);

create index invoices_owner_status_idx on invoices (owner_id, status);
create index invoices_due_date_idx on invoices (due_date) where status = 'unpaid';

create table reminder_log (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references invoices (id) on delete cascade,
  sent_at timestamptz not null default now(),
  type reminder_type not null,
  success boolean not null
);

create index reminder_log_invoice_idx on reminder_log (invoice_id);

-- BR-003: at most one overdue reminder per invoice per calendar day.
-- Cast via a fixed offset (not the session TimeZone GUC) so the
-- expression is IMMUTABLE and usable in an index.
create unique index reminder_log_one_overdue_per_day
  on reminder_log (invoice_id, ((sent_at at time zone 'utc')::date))
  where type = 'overdue' and success = true;

-- Create the profile row automatically when a new auth user signs up.
-- Role defaults to 'owner'; admin status is granted manually in the
-- database only (FR-010, "no self-serve upgrade path").
create function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id) values (new.id);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- Helper used by admin RLS policies. security definer + fixed search_path
-- so it can read profiles without recursing back through profiles' own
-- RLS policies.
create function is_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

alter table profiles enable row level security;
alter table clients enable row level security;
alter table invoices enable row level security;
alter table reminder_log enable row level security;

-- profiles
create policy "profiles_select_own" on profiles
  for select using (auth.uid() = id);

create policy "profiles_update_own" on profiles
  for update using (auth.uid() = id);

create policy "profiles_select_admin" on profiles
  for select using (is_admin());

-- clients
create policy "clients_all_own" on clients
  for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

create policy "clients_select_admin" on clients
  for select using (is_admin());

-- invoices
create policy "invoices_all_own" on invoices
  for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

create policy "invoices_select_admin" on invoices
  for select using (is_admin());

-- reminder_log: read-only from the client; the Edge Function writes with
-- the service role key, which bypasses RLS.
create policy "reminder_log_select_own" on reminder_log
  for select using (
    exists (
      select 1 from invoices
      where invoices.id = reminder_log.invoice_id
        and invoices.owner_id = auth.uid()
    )
  );

create policy "reminder_log_select_admin" on reminder_log
  for select using (is_admin());

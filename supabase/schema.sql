-- Reference schema for the Smart Document Workflow Supabase backend.
-- Apply once to a Supabase project after reviewing the policies for your deployment.
-- Monetary values are integer satang (THB * 100); never use floating point for money.

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  tax_id text,
  email text,
  phone text,
  address text,
  quote_prefix text not null default 'QT'
    check (quote_prefix ~ '^[A-Z0-9]{1,8}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.organization_members (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'member')),
  created_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);

create index organization_members_user_idx
  on public.organization_members(user_id, organization_id);

create or replace function public.guard_membership_identity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.organization_id is distinct from old.organization_id
     or new.user_id is distinct from old.user_id then
    raise exception 'Membership cannot be reassigned; add or remove a membership instead'
      using errcode = '22000';
  end if;
  return new;
end;
$$;

create trigger organization_members_guard_identity
before update on public.organization_members
for each row execute function public.guard_membership_identity();

-- SECURITY DEFINER avoids recursive RLS evaluation on organization_members.
create or replace function public.is_org_member(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.organization_members m
    where m.organization_id = p_organization_id
      and m.user_id = (select auth.uid())
  );
$$;

create or replace function public.is_org_admin(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.organization_members m
    where m.organization_id = p_organization_id
      and m.user_id = (select auth.uid())
      and m.role in ('owner', 'admin')
  );
$$;

revoke all on function public.is_org_member(uuid) from public, anon;
revoke all on function public.is_org_admin(uuid) from public, anon;
grant execute on function public.is_org_member(uuid) to authenticated;
grant execute on function public.is_org_admin(uuid) to authenticated;

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  tax_id text,
  branch text,
  contact_name text,
  email text,
  phone text,
  address text,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id)
);

create index customers_org_name_idx on public.customers(organization_id, name);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  code text,
  name text not null check (length(trim(name)) > 0),
  description text,
  unit text not null default 'รายการ',
  unit_price_satang bigint not null default 0 check (unit_price_satang >= 0),
  vat_rate_basis_points integer not null default 700
    check (vat_rate_basis_points between 0 and 10000),
  vat_applicable boolean not null default true,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, code)
);

create index products_org_name_idx on public.products(organization_id, name);

-- The sequence row is private. Its only normal mutation path is next_quote_number().
create table public.quote_sequences (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  quote_year integer not null check (quote_year between 2000 and 9999),
  last_value bigint not null check (last_value > 0),
  constraint quote_sequences_pkey primary key (organization_id, quote_year)
);

create table public.quotes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  quote_number text not null,
  quote_year integer not null check (quote_year between 2000 and 9999),
  sequence_number bigint not null check (sequence_number > 0),
  customer_id uuid,
  customer_name_snapshot text not null check (length(trim(customer_name_snapshot)) > 0),
  customer_tax_id_snapshot text,
  customer_branch_snapshot text,
  customer_contact_snapshot text,
  customer_email_snapshot text,
  customer_phone_snapshot text,
  customer_address_snapshot text,
  -- Keep the seller's details as they were when the quote was prepared.
  -- Keys map to the frontend companySnapshot object; the future API validates
  -- the required business fields before issuing the document.
  company_snapshot jsonb not null
    check (pg_catalog.jsonb_typeof(company_snapshot) = 'object'),
  status text not null default 'draft'
    check (status in ('draft', 'sent', 'approved', 'rejected', 'expired', 'cancelled')),
  issue_date date not null default current_date,
  valid_until date,
  follow_up_date date,
  currency char(3) not null default 'THB' check (currency ~ '^[A-Z]{3}$'),
  vat_rate_basis_points integer not null default 700
    check (vat_rate_basis_points between 0 and 10000),
  subtotal_satang bigint not null default 0 check (subtotal_satang >= 0),
  discount_satang bigint not null default 0 check (discount_satang >= 0),
  vat_satang bigint not null default 0 check (vat_satang >= 0),
  grand_total_satang bigint not null default 0 check (grand_total_satang >= 0),
  note text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, quote_number),
  unique (organization_id, quote_year, sequence_number),
  foreign key (organization_id, customer_id)
    references public.customers(organization_id, id) on delete restrict,
  check (valid_until is null or valid_until >= issue_date),
  check (discount_satang <= subtotal_satang),
  check (grand_total_satang = subtotal_satang - discount_satang + vat_satang)
);

create index quotes_org_created_idx
  on public.quotes(organization_id, created_at desc);
create index quotes_org_status_idx
  on public.quotes(organization_id, status, issue_date desc);
create index quotes_org_customer_idx
  on public.quotes(organization_id, customer_id);
create index quotes_org_follow_up_idx
  on public.quotes(organization_id, follow_up_date)
  where follow_up_date is not null;

create table public.quote_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  quote_id uuid not null,
  product_id uuid,
  position integer not null check (position > 0),
  product_code_snapshot text,
  name_snapshot text not null check (length(trim(name_snapshot)) > 0),
  description_snapshot text,
  unit_snapshot text not null,
  quantity numeric(14, 3) not null check (quantity > 0),
  unit_price_satang bigint not null check (unit_price_satang >= 0),
  discount_satang bigint not null default 0 check (discount_satang >= 0),
  vat_applicable boolean not null default true,
  vat_rate_basis_points integer not null default 700
    check (vat_rate_basis_points between 0 and 10000),
  line_subtotal_satang bigint not null check (line_subtotal_satang >= 0),
  line_vat_satang bigint not null default 0 check (line_vat_satang >= 0),
  line_total_satang bigint not null check (line_total_satang >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (organization_id, quote_id)
    references public.quotes(organization_id, id) on delete cascade,
  foreign key (organization_id, product_id)
    references public.products(organization_id, id) on delete restrict,
  unique (quote_id, position),
  check (discount_satang <= line_subtotal_satang),
  check (line_total_satang = line_subtotal_satang - discount_satang + line_vat_satang),
  check (vat_applicable or line_vat_satang = 0)
);

create index quote_items_org_quote_idx
  on public.quote_items(organization_id, quote_id, position);

create table public.audit_events (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id uuid not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index audit_events_org_time_idx
  on public.audit_events(organization_id, created_at desc);
create index audit_events_entity_idx
  on public.audit_events(organization_id, entity_type, entity_id);

-- Durable handoff point for a future worker. No LINE, email, Sheets, or n8n
-- consumer is configured by this schema.
create table public.integration_outbox (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  event_type text not null,
  aggregate_type text not null,
  aggregate_id uuid not null,
  payload jsonb not null,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'delivered', 'failed')),
  attempts integer not null default 0 check (attempts >= 0),
  available_at timestamptz not null default now(),
  locked_at timestamptz,
  delivered_at timestamptz,
  last_error text,
  created_at timestamptz not null default now()
);

create index integration_outbox_pending_idx
  on public.integration_outbox(status, available_at, id)
  where status in ('pending', 'failed');
create index integration_outbox_org_time_idx
  on public.integration_outbox(organization_id, created_at desc);

-- Internal tables have no updated_at trigger, but their tenant key must also
-- remain fixed when trusted workers update delivery state or clear actor FKs.
create or replace function public.guard_organization_id()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.organization_id is distinct from old.organization_id then
    raise exception 'Organization ownership cannot be changed'
      using errcode = '22000';
  end if;
  return new;
end;
$$;

create trigger quote_sequences_guard_organization
before update on public.quote_sequences
for each row execute function public.guard_organization_id();
create trigger audit_events_guard_organization
before update on public.audit_events
for each row execute function public.guard_organization_id();
create trigger integration_outbox_guard_organization
before update on public.integration_outbox
for each row execute function public.guard_organization_id();

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE'
     and pg_catalog.to_jsonb(new) -> 'organization_id'
         is distinct from pg_catalog.to_jsonb(old) -> 'organization_id' then
    raise exception 'Organization ownership cannot be changed'
      using errcode = '22000';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger organizations_touch_updated_at
before update on public.organizations
for each row execute function public.touch_updated_at();
create trigger customers_touch_updated_at
before update on public.customers
for each row execute function public.touch_updated_at();
create trigger products_touch_updated_at
before update on public.products
for each row execute function public.touch_updated_at();
create trigger quotes_touch_updated_at
before update on public.quotes
for each row execute function public.touch_updated_at();
create trigger quote_items_touch_updated_at
before update on public.quote_items
for each row execute function public.touch_updated_at();

-- This function is called from the quote INSERT trigger in the same database
-- transaction. A rollback rolls back the increment as well. The membership
-- check is retained here even though direct client execution is revoked.
create or replace function public.next_quote_number(
  p_organization_id uuid,
  p_issue_date date
)
returns table (quote_year integer, sequence_number bigint, quote_number text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prefix text;
  v_year integer;
  v_sequence bigint;
begin
  if (select auth.uid()) is null
     or not public.is_org_member(p_organization_id) then
    raise exception 'Organization membership required'
      using errcode = '42501';
  end if;

  v_year := extract(year from p_issue_date)::integer;
  if v_year < 2000 or v_year > 9999 then
    raise exception 'Issue date is outside the supported quote numbering range'
      using errcode = '22008';
  end if;

  select o.quote_prefix
    into v_prefix
    from public.organizations o
    where o.id = p_organization_id;
  if not found then
    raise exception 'Organization not found' using errcode = '23503';
  end if;

  insert into public.quote_sequences as existing (organization_id, quote_year, last_value)
  values (p_organization_id, v_year, 1)
  on conflict on constraint quote_sequences_pkey
  do update set last_value = existing.last_value + 1
  returning last_value into v_sequence;

  return query
    select v_year,
           v_sequence,
           pg_catalog.format(
             '%s-%s-%s',
             v_prefix,
             v_year,
             pg_catalog.lpad(
               v_sequence::text,
               greatest(5, pg_catalog.length(v_sequence::text)),
               '0'
             )
           );
end;
$$;

revoke all on function public.next_quote_number(uuid, date) from public, anon, authenticated;

create or replace function public.assign_quote_number()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'draft' then
      raise exception 'Create a draft, save its items, and issue it in one transaction'
        using errcode = '22000';
    end if;
    select n.quote_year, n.sequence_number, n.quote_number
      into new.quote_year, new.sequence_number, new.quote_number
      from public.next_quote_number(new.organization_id, new.issue_date) n;
    new.created_by := (select auth.uid());
    return new;
  end if;

  if new.quote_number is distinct from old.quote_number
     or new.quote_year is distinct from old.quote_year
     or new.sequence_number is distinct from old.sequence_number
     or new.organization_id is distinct from old.organization_id
     or new.issue_date is distinct from old.issue_date then
    raise exception 'Quote number, organization, and issue date are immutable; create a new quote instead'
      using errcode = '22000';
  end if;

  if old.status <> 'draft' then
    if new.status = 'draft' then
      raise exception 'An issued quote cannot return to draft; create a new revision instead'
        using errcode = '22000';
    end if;

    -- Lifecycle status and a reminder date may change after issue. Exclude the
    -- creator reference so auth.users ON DELETE SET NULL can clear it without
    -- changing the commercial document. The future API owns author attribution.
    if (pg_catalog.to_jsonb(new) - array['status', 'follow_up_date', 'updated_at', 'created_by'])
       is distinct from
       (pg_catalog.to_jsonb(old) - array['status', 'follow_up_date', 'updated_at', 'created_by']) then
      raise exception 'Issued quote content is immutable; create a new revision instead'
        using errcode = '22000';
    end if;
  end if;
  return new;
end;
$$;

create trigger quotes_assign_number
before insert or update on public.quotes
for each row execute function public.assign_quote_number();

create or replace function public.guard_quote_items()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_quote_id uuid;
  v_organization_id uuid;
  v_status text;
begin
  if tg_op = 'UPDATE' then
    if new.organization_id is distinct from old.organization_id
       or new.quote_id is distinct from old.quote_id then
      raise exception 'Quote items cannot be moved between quotes or organizations'
        using errcode = '22000';
    end if;
  end if;

  if tg_op = 'DELETE' then
    v_quote_id := old.quote_id;
    v_organization_id := old.organization_id;
  else
    v_quote_id := new.quote_id;
    v_organization_id := new.organization_id;
  end if;

  -- Lock the same parent row that a status update locks, so an item mutation
  -- and issue transition cannot both pass against a stale draft status.
  select q.status
    into v_status
    from public.quotes q
    where q.id = v_quote_id and q.organization_id = v_organization_id
    for update;

  if not found then
    -- A trusted parent DELETE can reach this path through FK ON DELETE CASCADE.
    -- Normal authenticated clients have no DELETE grant on quotes.
    if tg_op = 'DELETE' then
      return old;
    end if;
    raise exception 'Quote parent not found' using errcode = '23503';
  end if;

  if v_status <> 'draft' then
    raise exception 'Items of an issued quote are immutable; create a new revision instead'
      using errcode = '22000';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger quote_items_guard_changes
before insert or update or delete on public.quote_items
for each row execute function public.guard_quote_items();

create or replace function public.record_quote_changes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_action text;
  v_event text;
begin
  if tg_op = 'INSERT' then
    v_action := 'quote.created';
    v_event := 'quote.created';
  elsif new.status is distinct from old.status then
    v_action := 'quote.status_changed';
    v_event := 'quote.status_changed';
  else
    v_action := 'quote.updated';
    v_event := 'quote.updated';
  end if;

  insert into public.audit_events (
    organization_id, actor_id, action, entity_type, entity_id, metadata
  ) values (
    new.organization_id,
    coalesce((select auth.uid()), new.created_by),
    v_action,
    'quote',
    new.id,
    pg_catalog.jsonb_build_object(
      'quote_number', new.quote_number,
      'status', new.status,
      'grand_total_satang', new.grand_total_satang
    )
  );

  insert into public.integration_outbox (
    organization_id, event_type, aggregate_type, aggregate_id, payload
  ) values (
    new.organization_id,
    v_event,
    'quote',
    new.id,
    pg_catalog.jsonb_build_object(
      'quote_id', new.id,
      'quote_number', new.quote_number,
      'status', new.status,
      'grand_total_satang', new.grand_total_satang
    )
  );

  return new;
end;
$$;

create trigger quotes_record_changes
after insert or update on public.quotes
for each row execute function public.record_quote_changes();

alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;
alter table public.customers enable row level security;
alter table public.products enable row level security;
alter table public.quote_sequences enable row level security;
alter table public.quotes enable row level security;
alter table public.quote_items enable row level security;
alter table public.audit_events enable row level security;
alter table public.integration_outbox enable row level security;

create policy organizations_read_member on public.organizations
  for select to authenticated
  using (public.is_org_member(id));
create policy organizations_update_admin on public.organizations
  for update to authenticated
  using (public.is_org_admin(id))
  with check (public.is_org_admin(id));

create policy organization_members_read_tenant on public.organization_members
  for select to authenticated
  using (user_id = (select auth.uid()) or public.is_org_admin(organization_id));
create policy organization_members_insert_admin on public.organization_members
  for insert to authenticated
  with check (public.is_org_admin(organization_id));
create policy organization_members_update_admin on public.organization_members
  for update to authenticated
  using (public.is_org_admin(organization_id))
  with check (public.is_org_admin(organization_id));
create policy organization_members_delete_admin on public.organization_members
  for delete to authenticated
  using (public.is_org_admin(organization_id));

create policy customers_read_tenant on public.customers
  for select to authenticated using (public.is_org_member(organization_id));
create policy customers_insert_tenant on public.customers
  for insert to authenticated with check (public.is_org_member(organization_id));
create policy customers_update_tenant on public.customers
  for update to authenticated
  using (public.is_org_member(organization_id))
  with check (public.is_org_member(organization_id));

create policy products_read_tenant on public.products
  for select to authenticated using (public.is_org_member(organization_id));
create policy products_insert_tenant on public.products
  for insert to authenticated with check (public.is_org_member(organization_id));
create policy products_update_tenant on public.products
  for update to authenticated
  using (public.is_org_member(organization_id))
  with check (public.is_org_member(organization_id));

create policy quotes_read_tenant on public.quotes
  for select to authenticated using (public.is_org_member(organization_id));
create policy quotes_insert_tenant on public.quotes
  for insert to authenticated with check (public.is_org_member(organization_id));
create policy quotes_update_tenant on public.quotes
  for update to authenticated
  using (public.is_org_member(organization_id))
  with check (public.is_org_member(organization_id));

create policy quote_items_read_tenant on public.quote_items
  for select to authenticated using (public.is_org_member(organization_id));
create policy quote_items_insert_tenant on public.quote_items
  for insert to authenticated with check (public.is_org_member(organization_id));
create policy quote_items_update_tenant on public.quote_items
  for update to authenticated
  using (public.is_org_member(organization_id))
  with check (public.is_org_member(organization_id));
create policy quote_items_delete_tenant on public.quote_items
  for delete to authenticated using (public.is_org_member(organization_id));

create policy audit_events_read_admin on public.audit_events
  for select to authenticated using (public.is_org_admin(organization_id));
create policy integration_outbox_read_admin on public.integration_outbox
  for select to authenticated using (public.is_org_admin(organization_id));

-- Keep table privileges explicit; RLS policies further restrict each row.
revoke all on public.organizations, public.organization_members, public.customers,
  public.products, public.quote_sequences, public.quotes, public.quote_items,
  public.audit_events, public.integration_outbox from anon, authenticated;
grant select, update on public.organizations to authenticated;
grant select, insert, update, delete on public.organization_members to authenticated;
grant select, insert, update on public.customers, public.products, public.quotes to authenticated;
grant select, insert, update, delete on public.quote_items to authenticated;
grant select on public.audit_events, public.integration_outbox to authenticated;

-- Organization and first-owner provisioning must happen through a trusted
-- server/admin path. Do not expose a Supabase service-role key in the browser.

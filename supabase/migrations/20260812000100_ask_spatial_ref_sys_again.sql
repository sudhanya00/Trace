-- spatial_ref_sys, asked again (advisor mail, 2026-08-09).
--
-- 20260726000300 recorded, in a comment and deliberately without a statement,
-- that this table cannot be secured from a migration. That finding is now two
-- weeks old and the advisor is still mailing, so this stops quoting it and asks
-- the database instead — on whichever database it runs against, and prints the
-- answer.
--
-- WHY THERE WAS NO STATEMENT LAST TIME, AND WHY THIS ONE IS SAFE
--
-- The trap here is `revoke all on spatial_ref_sys from anon`. Issued by a role
-- that is not the grantor it raises NO ERROR and changes NOTHING. A migration
-- built on it would apply cleanly, pass its tests, and leave anon holding
-- INSERT and DELETE on the table every geography operation in this app depends
-- on. So nothing in here trusts a statement that returned without complaining;
-- the check at the end reads the catalogue back.
--
-- WHAT IT TRIES, IN ORDER, AND WHAT EACH COSTS IF IT WORKS
--
--   1. enable row level security  — needs ownership (supabase_admin owns it;
--      migrations run as postgres). If it lands, the table stops being writable
--      through PostgREST by anon.
--
--   2. a permissive SELECT policy, IMMEDIATELY, and this is not optional:
--      PostGIS reads spatial_ref_sys internally. RLS enabled with no policy at
--      all would deny those reads to every non-superuser role and break
--      geography operations for real users. That would trade a vandalism risk
--      for an outage, which is a worse trade than doing nothing.
--
--      It is deliberately NOT inside an exception handler. If step 1 succeeds
--      and this fails, the whole migration must abort and roll back — leaving
--      RLS half-applied is the one outcome worse than leaving it alone.
--
-- Reading this table is harmless: EPSG definitions are public reference data
-- and the app itself never queries it — every geography operation goes through
-- a definer function that runs as the owner. So SELECT stays open to everybody
-- and only the write privileges are the point.
do $$
declare
  did_enable boolean := false;
  rls_on     boolean;
  tbl_owner  text;
begin
  select c.relrowsecurity, pg_get_userbyid(c.relowner)
    into rls_on, tbl_owner
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = 'spatial_ref_sys';

  if not found then
    raise notice 'spatial_ref_sys: not present on this database — nothing to do';
    return;
  end if;

  raise notice 'spatial_ref_sys: owner=% rls=% (running as %)', tbl_owner, rls_on, current_user;

  if rls_on then
    raise notice 'spatial_ref_sys: RLS already enabled — nothing to do';
    return;
  end if;

  begin
    execute 'alter table public.spatial_ref_sys enable row level security';
    did_enable := true;
  exception when others then
    raise notice 'spatial_ref_sys: COULD NOT enable RLS (%) — %', sqlstate, sqlerrm;
    raise notice 'spatial_ref_sys: still open to anon. Dashboard advisor or Supabase support.';
  end;

  if did_enable then
    -- Outside the handler on purpose: a failure here aborts the migration and
    -- takes the ALTER above with it.
    execute 'create policy spatial_ref_sys_read on public.spatial_ref_sys for select using (true)';
    raise notice 'spatial_ref_sys: RLS ENABLED, reads left open, writes now refused';
  end if;
end $$;

-- And the honest part: read the catalogue back rather than believing the block
-- above. A statement that returned quietly is not evidence of anything here.
do $$
declare
  rls_on boolean;
  writes text;
begin
  select c.relrowsecurity into rls_on
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = 'spatial_ref_sys';

  if rls_on is null then
    return;
  end if;

  -- has_table_privilege, NOT information_schema.role_table_grants. That view
  -- only shows grants where the current user is the grantor, the grantee, or a
  -- member of it — so as `postgres` it can report "none" while anon holds
  -- INSERT quite happily. A check that reports clean because it cannot see the
  -- grant is the same failure as the revoke that returns without doing
  -- anything, and this file exists because of that failure.
  select string_agg(held.label, ', ' order by held.label)
    into writes
    from (
      select who.rolename || ':' || priv.verb as label
      from unnest(array['anon', 'authenticated']) as who(rolename)
      cross join unnest(array['INSERT', 'UPDATE', 'DELETE']) as priv(verb)
      where has_table_privilege(who.rolename, 'public.spatial_ref_sys', priv.verb)
    ) held;

  raise notice 'spatial_ref_sys VERDICT: rls=% | client write grants still present: %',
    rls_on, coalesce(writes, 'none');

  if not rls_on and writes is not null then
    raise warning 'spatial_ref_sys is still writable by anon/authenticated. This is the advisor''s critical finding and it CANNOT be closed from a migration — it needs Supabase support or the dashboard advisor.';
  end if;
end $$;

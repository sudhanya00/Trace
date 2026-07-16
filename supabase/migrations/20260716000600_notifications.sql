-- Notifications: a follow request nobody sees is a follow request that dies.
-- Two delivery paths from one write: an in-app inbox row (always) and an
-- Expo push via pg_net (when the rider has registered tokens). The inbox is
-- the source of truth; push is best-effort.

create extension if not exists pg_net;

create table push_tokens (
  token text primary key,
  profile_id uuid not null references profiles(id) on delete cascade,
  platform text,
  updated_at timestamptz not null default now()
);
create index on push_tokens (profile_id);

alter table push_tokens enable row level security;
grant select, insert, update, delete on push_tokens to authenticated;
create policy push_tokens_own on push_tokens for all to authenticated
  using (profile_id = auth.uid())
  with check (profile_id = auth.uid());

create table notifications (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  title text not null,
  body text,
  data jsonb not null default '{}'::jsonb,
  read boolean not null default false,
  created_at timestamptz not null default now()
);
create index on notifications (profile_id, created_at desc);

alter table notifications enable row level security;
grant select, update, delete on notifications to authenticated;
create policy notifications_own on notifications for all to authenticated
  using (profile_id = auth.uid())
  with check (profile_id = auth.uid());

-- ---------------------------------------------------------------------------
-- The single fan-out point. SECURITY DEFINER: triggers fire as the acting
-- user, who must not be able to read the recipient's tokens — but the
-- function may. Inserts the inbox row, then queues one push per token.
-- pg_net is async; the calling transaction never waits on Expo.
-- ---------------------------------------------------------------------------
create or replace function notify_profile(
  p_profile_id uuid,
  p_title text,
  p_body text,
  p_data jsonb default '{}'::jsonb
)
returns void
language plpgsql security definer set search_path = public as $$
declare
  payload jsonb;
begin
  insert into notifications (profile_id, title, body, data)
  values (p_profile_id, p_title, p_body, p_data);

  select jsonb_agg(jsonb_build_object(
    'to', t.token,
    'title', p_title,
    'body', p_body,
    'data', p_data
  ))
  into payload
  from push_tokens t
  where t.profile_id = p_profile_id;

  if payload is not null then
    perform net.http_post(
      url := 'https://exp.host/--/api/v2/push/send',
      headers := '{"Content-Type": "application/json"}'::jsonb,
      body := payload
    );
  end if;
end;
$$;

revoke all on function notify_profile(uuid, text, text, jsonb) from public;

-- ---------------------------------------------------------------------------
-- Event triggers. Copy voice rules apply even here: plain verbs, no alarm.
-- ---------------------------------------------------------------------------
create or replace function notify_on_follow()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  follower_handle text;
begin
  select handle into follower_handle from profiles where id = new.follower_id;
  if new.state = 'pending' then
    perform notify_profile(
      new.followee_id,
      '@' || follower_handle || ' asked to follow you',
      'Accept or decline in Riders.',
      jsonb_build_object('url', '/rider/' || new.follower_id)
    );
  else
    perform notify_profile(
      new.followee_id,
      '@' || follower_handle || ' started following you',
      null,
      jsonb_build_object('url', '/rider/' || new.follower_id)
    );
  end if;
  return new;
end;
$$;

create trigger trg_notify_follow
after insert on follows
for each row execute function notify_on_follow();

create or replace function notify_on_follow_accept()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  followee_handle text;
begin
  if old.state = 'pending' and new.state = 'accepted' then
    select handle into followee_handle from profiles where id = new.followee_id;
    perform notify_profile(
      new.follower_id,
      '@' || followee_handle || ' accepted your follow',
      'Their rides and routes are open to you now.',
      jsonb_build_object('url', '/rider/' || new.followee_id)
    );
  end if;
  return new;
end;
$$;

create trigger trg_notify_follow_accept
after update on follows
for each row execute function notify_on_follow_accept();

create or replace function notify_on_route_comment()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  route_owner uuid;
  route_name text;
  commenter text;
begin
  select r.profile_id, r.name into route_owner, route_name from routes r where r.id = new.route_id;
  if route_owner is null or route_owner = new.profile_id then
    return new;
  end if;
  select handle into commenter from profiles where id = new.profile_id;
  perform notify_profile(
    route_owner,
    '@' || commenter || ' on ' || route_name,
    left(new.body, 120),
    jsonb_build_object('url', '/route/' || new.route_id)
  );
  return new;
end;
$$;

create trigger trg_notify_route_comment
after insert on route_comments
for each row execute function notify_on_route_comment();

create or replace function notify_on_condition_report()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  route_owner uuid;
  route_name text;
begin
  select r.profile_id, r.name into route_owner, route_name from routes r where r.id = new.route_id;
  if route_owner is null or route_owner = new.profile_id then
    return new;
  end if;
  perform notify_profile(
    route_owner,
    route_name || ': ' || upper(new.status),
    coalesce(new.note, 'New condition report on your route.'),
    jsonb_build_object('url', '/route/' || new.route_id)
  );
  return new;
end;
$$;

create trigger trg_notify_condition
after insert on condition_reports
for each row execute function notify_on_condition_report();

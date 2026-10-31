-- Bands for Days: classes (phase E2). Paste into Supabase > SQL Editor and Run (safe to run again).
-- Every student signed up with a class code; this copies that code onto their leaderboard row so the
-- site can show a class leaderboard and class view. Reading stays as it is (signed-in users can read scores).
create schema if not exists private;
alter table public.scores add column if not exists class_code text not null default '';

create or replace function private.class_code_of(uid uuid) returns text
language sql security definer set search_path = '' as $$
  select upper(trim(coalesce(u.raw_user_meta_data->>'class_code', ''))) from auth.users u where u.id = uid
$$;
revoke all on function private.class_code_of(uuid) from public;

create or replace function public.scores_fill_class() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.class_code := coalesce(private.class_code_of(new.user_id), '');
  return new;
end $$;
drop trigger if exists scores_fill_class on public.scores;
create trigger scores_fill_class before insert or update on public.scores
  for each row execute function public.scores_fill_class();

-- fill in everyone who already has a row
update public.scores set class_code = coalesce(private.class_code_of(user_id), '');
create index if not exists scores_class_idx on public.scores (class_code, xp desc);
-- check:  select class_code, count(*) from public.scores group by 1;

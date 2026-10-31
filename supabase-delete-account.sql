-- Bands for Days: let a signed-in student delete their own account (App Store rule 5.1.1(v), and good manners).
-- Paste into Supabase > SQL Editor and Run (safe to run again). The app calls it with  supabase.rpc('delete_my_account')
-- after the Worker has cancelled any Plus subscription (/api/account/delete).
-- progress, scores and feedback rows go with the user through their "on delete cascade" foreign keys.
create or replace function public.delete_my_account() returns void
language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'not signed in'; end if;
  delete from public.progress where user_id = uid;
  delete from public.scores where user_id = uid;
  delete from public.feedback where user_id = uid;
  delete from auth.users where id = uid;
end $$;
revoke all on function public.delete_my_account() from public;
grant execute on function public.delete_my_account() to authenticated;
-- check:  select proname from pg_proc where proname = 'delete_my_account';

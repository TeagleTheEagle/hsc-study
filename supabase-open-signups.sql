-- Bands for Days: let anyone sign up without a class code (31 Oct 2026). Paste into Supabase > SQL Editor and Run.
-- Safe to run again, and harmless if supabase-hardening.sql was never run (then nothing was blocking sign-ups anyway).
-- A class code typed at sign-up still puts the student on that class leaderboard; it is just no longer required.
do $$
begin
  if to_regclass('private.class_codes') is not null then
    insert into private.class_codes (code, note) values ('*', 'open sign-ups, 31 Oct 2026') on conflict do nothing;
  end if;
end $$;
-- To require a code again later:  delete from private.class_codes where code = '*';

-- Bands for Days: in-app feedback (phase B beta). Paste into Supabase > SQL Editor and Run.
-- Signed-in students can insert their own feedback; only you (the dashboard / service role) can read it.
create table if not exists public.feedback (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  text text not null check (char_length(text) between 3 and 2000),
  page text not null default '',
  subject text not null default '',
  agent text not null default '',
  created_at timestamptz not null default now()
);
alter table public.feedback enable row level security;
drop policy if exists "feedback: insert own" on public.feedback;
create policy "feedback: insert own" on public.feedback
  for insert to authenticated with check (auth.uid() = user_id);
-- Read it in Supabase > Table editor > feedback, or:  select created_at, subject, page, text from public.feedback order by created_at desc;

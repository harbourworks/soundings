create table public.notes (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null references auth.users (id),
  body text not null,
  created_at timestamptz not null default now()
);

alter table public.notes enable row level security;

create policy "owners read their notes" on public.notes
  for select using (auth.uid() = owner);

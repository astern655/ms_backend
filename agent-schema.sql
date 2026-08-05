-- Borderless: 에이전트/세션 스키마
-- Supabase 대시보드 → SQL Editor 에서 1회 실행.
-- RLS는 켜두고 정책은 두지 않는다 → 백엔드(service_role)만 접근, anon 차단.

-- 그룹당 에이전트 1개
create table if not exists public.group_agents (
  group_id uuid primary key references public.groups(id) on delete cascade,
  name text not null default '팀 에이전트',
  system_prompt text not null default '',
  skills jsonb not null default
    '{"docs_rag":true,"summarize":true,"action_items":false,"translate":false}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.group_agents enable row level security;

-- 팀당 세션 1개 (세션 = 팀의 대화 스레드)
create table if not exists public.agent_messages (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  group_id uuid not null references public.groups(id) on delete cascade,
  role text not null check (role in ('user','ai')),
  content text not null,
  sources jsonb,
  ts timestamptz not null default now()
);
create index if not exists agent_messages_team_ts on public.agent_messages (team_id, ts);
alter table public.agent_messages enable row level security;

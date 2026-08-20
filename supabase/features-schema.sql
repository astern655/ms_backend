-- ============================================================
-- Borderless 통합 스키마 (선택 기능용) — Supabase SQL Editor에서 1회 실행
-- 채팅/반응/핀/스레드/DM · 문서 댓글/버전 · 대기실/자동승인 · 회의 예약
-- · 역할 · 채널 알림음소거 · 멘션 알림 · 문서 이미지 버킷
-- (RLS: 그룹/팀 멤버 기반. 재실행 안전하도록 drop policy if exists 사용)
-- ============================================================

-- ---- 0. RLS 헬퍼 ----
create or replace function public.is_group_member(g uuid) returns boolean
language sql security definer stable set search_path = public as $$
  select exists(select 1 from public.group_members gm where gm.group_id = g and gm.user_id = auth.uid());
$$;
create or replace function public.is_team_member(t uuid) returns boolean
language sql security definer stable set search_path = public as $$
  select exists(select 1 from public.team_members tm where tm.team_id = t and tm.user_id = auth.uid());
$$;
create or replace function public.is_group_owner(g uuid) returns boolean
language sql security definer stable set search_path = public as $$
  select exists(select 1 from public.groups gr where gr.id = g and gr.owner_id = auth.uid());
$$;

-- ---- 1. 역할(13) ----
alter table public.group_members add column if not exists role text not null default 'member'; -- owner|admin|member

-- ---- 2. 채팅 메시지(14 멘션 · 16 반응 · 19 핀 · 15 스레드 · 18 DM) ----
create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  team_id uuid references public.teams(id) on delete cascade,   -- 팀 채널 메시지
  dm_key text,                                                  -- DM: 'uidA:uidB'(정렬)
  user_id uuid not null references auth.users(id) on delete cascade,
  author_name text not null,
  content text not null,
  parent_id uuid references public.messages(id) on delete cascade, -- 스레드 답글
  pinned boolean not null default false,
  mentions uuid[] not null default '{}',
  created_at timestamptz not null default now(),
  edited_at timestamptz
);
create index if not exists messages_team_created on public.messages(team_id, created_at);
create index if not exists messages_dm_created on public.messages(dm_key, created_at);
alter table public.messages enable row level security;
drop policy if exists msg_read on public.messages;
create policy msg_read on public.messages for select using (
  (team_id is not null and public.is_team_member(team_id))
  or (dm_key is not null and public.is_group_member(group_id) and position(auth.uid()::text in dm_key) > 0)
);
drop policy if exists msg_insert on public.messages;
create policy msg_insert on public.messages for insert with check (user_id = auth.uid() and public.is_group_member(group_id));
drop policy if exists msg_update on public.messages;
create policy msg_update on public.messages for update using (user_id = auth.uid() or public.is_group_owner(group_id))
  with check (user_id = auth.uid() or public.is_group_owner(group_id));
drop policy if exists msg_delete on public.messages;
create policy msg_delete on public.messages for delete using (user_id = auth.uid() or public.is_group_owner(group_id));

-- ---- 3. 메시지 반응(16) ----
create table if not exists public.message_reactions (
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  emoji text not null,
  primary key (message_id, user_id, emoji)
);
alter table public.message_reactions enable row level security;
drop policy if exists react_read on public.message_reactions;
create policy react_read on public.message_reactions for select using (
  exists(select 1 from public.messages m where m.id = message_id
         and (m.team_id is not null and public.is_team_member(m.team_id)
              or (m.dm_key is not null and position(auth.uid()::text in m.dm_key) > 0)))
);
drop policy if exists react_write on public.message_reactions;
create policy react_write on public.message_reactions for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---- 4. 문서 댓글(31) ----
create table if not exists public.doc_comments (
  id uuid primary key default gen_random_uuid(),
  doc_id uuid not null references public.docs(id) on delete cascade,
  group_id uuid not null references public.groups(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  author_name text not null,
  content text not null,
  created_at timestamptz not null default now()
);
create index if not exists doc_comments_doc on public.doc_comments(doc_id, created_at);
alter table public.doc_comments enable row level security;
drop policy if exists dc_read on public.doc_comments;
create policy dc_read on public.doc_comments for select using (public.is_group_member(group_id));
drop policy if exists dc_insert on public.doc_comments;
create policy dc_insert on public.doc_comments for insert with check (user_id = auth.uid() and public.is_group_member(group_id));
drop policy if exists dc_delete on public.doc_comments;
create policy dc_delete on public.doc_comments for delete using (user_id = auth.uid() or public.is_group_owner(group_id));

-- ---- 5. 문서 버전 히스토리(33) ----
create table if not exists public.doc_versions (
  id uuid primary key default gen_random_uuid(),
  doc_id uuid not null references public.docs(id) on delete cascade,
  group_id uuid not null references public.groups(id) on delete cascade,
  title text,
  content text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create index if not exists doc_versions_doc on public.doc_versions(doc_id, created_at desc);
alter table public.doc_versions enable row level security;
drop policy if exists dv_read on public.doc_versions;
create policy dv_read on public.doc_versions for select using (public.is_group_member(group_id));
drop policy if exists dv_insert on public.doc_versions;
create policy dv_insert on public.doc_versions for insert with check (public.is_group_member(group_id));

-- ---- 6. 대기실/자동 승인(7) ----
alter table public.teams add column if not exists auto_approve boolean not null default true; -- 기본: 요청 시 즉시 패스
create table if not exists public.meeting_requests (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  group_id uuid not null references public.groups(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  status text not null default 'pending', -- pending|approved|denied
  created_at timestamptz not null default now()
);
create index if not exists mr_team on public.meeting_requests(team_id, created_at);
alter table public.meeting_requests enable row level security;
drop policy if exists mr_read on public.meeting_requests;
create policy mr_read on public.meeting_requests for select using (user_id = auth.uid() or public.is_team_member(team_id));
drop policy if exists mr_insert on public.meeting_requests;
create policy mr_insert on public.meeting_requests for insert with check (user_id = auth.uid() and public.is_group_member(group_id));
drop policy if exists mr_update on public.meeting_requests;
create policy mr_update on public.meeting_requests for update using (public.is_team_member(team_id) or public.is_group_owner(group_id));

-- ---- 7. 회의 예약(11) ----
create table if not exists public.meeting_schedule (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  group_id uuid not null references public.groups(id) on delete cascade,
  title text not null,
  start_at timestamptz not null,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create index if not exists ms_group_start on public.meeting_schedule(group_id, start_at);
alter table public.meeting_schedule enable row level security;
drop policy if exists ms_read on public.meeting_schedule;
create policy ms_read on public.meeting_schedule for select using (public.is_group_member(group_id));
drop policy if exists ms_write on public.meeting_schedule;
create policy ms_write on public.meeting_schedule for all using (public.is_group_member(group_id)) with check (public.is_group_member(group_id));

-- ---- 8. 채널 알림 음소거(20) ----
create table if not exists public.channel_mutes (
  user_id uuid not null references auth.users(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  primary key (user_id, team_id)
);
alter table public.channel_mutes enable row level security;
drop policy if exists cm_all on public.channel_mutes;
create policy cm_all on public.channel_mutes for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---- 9. 알림(14 멘션 · 18 DM) ----
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null,          -- mention|dm|request
  title text,
  body text,
  link text,
  read boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists notif_user on public.notifications(user_id, created_at desc);
alter table public.notifications enable row level security;
drop policy if exists nt_read on public.notifications;
create policy nt_read on public.notifications for select using (user_id = auth.uid());
drop policy if exists nt_update on public.notifications;
create policy nt_update on public.notifications for update using (user_id = auth.uid());
drop policy if exists nt_insert on public.notifications;
create policy nt_insert on public.notifications for insert with check (true); -- 멘션 알림은 백엔드/작성자가 삽입

-- ---- 10. 실시간 구독 활성화 ----
alter publication supabase_realtime add table public.messages;
alter publication supabase_realtime add table public.message_reactions;
alter publication supabase_realtime add table public.doc_comments;
alter publication supabase_realtime add table public.meeting_requests;
alter publication supabase_realtime add table public.notifications;

-- ---- 11. 문서 이미지 스토리지(28) ----
insert into storage.buckets (id, name, public) values ('doc-images', 'doc-images', true)
on conflict (id) do nothing;
drop policy if exists dimg_read on storage.objects;
create policy dimg_read on storage.objects for select using (bucket_id = 'doc-images');
drop policy if exists dimg_write on storage.objects;
create policy dimg_write on storage.objects for insert to authenticated with check (bucket_id = 'doc-images');

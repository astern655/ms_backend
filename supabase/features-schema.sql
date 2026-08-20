-- ============================================================
-- Borderless 통합 스키마 (선택 기능용) — Supabase SQL Editor에서 1회 실행
-- 멤버십 체크는 모두 인라인(기존 RLS 헬퍼 함수와 충돌 방지). 재실행 안전.
-- ============================================================

-- ---- 1. 역할(13) ----
alter table public.group_members add column if not exists role text not null default 'member';
-- 그룹 대표가 멤버 역할(관리자/일반)을 변경할 수 있도록 UPDATE 정책 추가(가산적, 안전).
drop policy if exists gm_owner_update on public.group_members;
create policy gm_owner_update on public.group_members for update using (
  exists(select 1 from public.groups g where g.id = group_members.group_id and g.owner_id = auth.uid())
) with check (
  exists(select 1 from public.groups g where g.id = group_members.group_id and g.owner_id = auth.uid())
);

-- ---- 2. 채팅 메시지(14/16/19/15/18) ----
create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  team_id uuid references public.teams(id) on delete cascade,
  dm_key text,
  user_id uuid not null references auth.users(id) on delete cascade,
  author_name text not null,
  content text not null,
  parent_id uuid references public.messages(id) on delete cascade,
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
  (team_id is not null and exists(select 1 from public.team_members tm where tm.team_id = messages.team_id and tm.user_id = auth.uid()))
  or (dm_key is not null
      and exists(select 1 from public.group_members gm where gm.group_id = messages.group_id and gm.user_id = auth.uid())
      and position(auth.uid()::text in dm_key) > 0)
);
drop policy if exists msg_insert on public.messages;
create policy msg_insert on public.messages for insert with check (
  user_id = auth.uid()
  and exists(select 1 from public.group_members gm where gm.group_id = messages.group_id and gm.user_id = auth.uid())
);
drop policy if exists msg_update on public.messages;
create policy msg_update on public.messages for update using (
  user_id = auth.uid() or exists(select 1 from public.groups gr where gr.id = messages.group_id and gr.owner_id = auth.uid())
) with check (
  user_id = auth.uid() or exists(select 1 from public.groups gr where gr.id = messages.group_id and gr.owner_id = auth.uid())
);
drop policy if exists msg_delete on public.messages;
create policy msg_delete on public.messages for delete using (
  user_id = auth.uid() or exists(select 1 from public.groups gr where gr.id = messages.group_id and gr.owner_id = auth.uid())
);

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
  exists(
    select 1 from public.messages m where m.id = message_reactions.message_id and (
      (m.team_id is not null and exists(select 1 from public.team_members tm where tm.team_id = m.team_id and tm.user_id = auth.uid()))
      or (m.dm_key is not null and position(auth.uid()::text in m.dm_key) > 0)
    )
  )
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
create policy dc_read on public.doc_comments for select using (
  exists(select 1 from public.group_members gm where gm.group_id = doc_comments.group_id and gm.user_id = auth.uid())
);
drop policy if exists dc_insert on public.doc_comments;
create policy dc_insert on public.doc_comments for insert with check (
  user_id = auth.uid()
  and exists(select 1 from public.group_members gm where gm.group_id = doc_comments.group_id and gm.user_id = auth.uid())
);
drop policy if exists dc_delete on public.doc_comments;
create policy dc_delete on public.doc_comments for delete using (
  user_id = auth.uid() or exists(select 1 from public.groups gr where gr.id = doc_comments.group_id and gr.owner_id = auth.uid())
);

-- ---- 5. 문서 버전(33) ----
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
create policy dv_read on public.doc_versions for select using (
  exists(select 1 from public.group_members gm where gm.group_id = doc_versions.group_id and gm.user_id = auth.uid())
);
drop policy if exists dv_insert on public.doc_versions;
create policy dv_insert on public.doc_versions for insert with check (
  exists(select 1 from public.group_members gm where gm.group_id = doc_versions.group_id and gm.user_id = auth.uid())
);

-- ---- 6. 대기실/자동승인(7) ----
alter table public.teams add column if not exists auto_approve boolean not null default true;
create table if not exists public.meeting_requests (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  group_id uuid not null references public.groups(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  status text not null default 'pending',
  created_at timestamptz not null default now()
);
create index if not exists mr_team on public.meeting_requests(team_id, created_at);
alter table public.meeting_requests enable row level security;
drop policy if exists mr_read on public.meeting_requests;
create policy mr_read on public.meeting_requests for select using (
  user_id = auth.uid()
  or exists(select 1 from public.team_members tm where tm.team_id = meeting_requests.team_id and tm.user_id = auth.uid())
);
drop policy if exists mr_insert on public.meeting_requests;
create policy mr_insert on public.meeting_requests for insert with check (
  user_id = auth.uid()
  and exists(select 1 from public.group_members gm where gm.group_id = meeting_requests.group_id and gm.user_id = auth.uid())
);
drop policy if exists mr_update on public.meeting_requests;
create policy mr_update on public.meeting_requests for update using (
  exists(select 1 from public.team_members tm where tm.team_id = meeting_requests.team_id and tm.user_id = auth.uid())
  or exists(select 1 from public.groups gr where gr.id = meeting_requests.group_id and gr.owner_id = auth.uid())
);

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
create policy ms_read on public.meeting_schedule for select using (
  exists(select 1 from public.group_members gm where gm.group_id = meeting_schedule.group_id and gm.user_id = auth.uid())
);
drop policy if exists ms_write on public.meeting_schedule;
create policy ms_write on public.meeting_schedule for all using (
  exists(select 1 from public.group_members gm where gm.group_id = meeting_schedule.group_id and gm.user_id = auth.uid())
) with check (
  exists(select 1 from public.group_members gm where gm.group_id = meeting_schedule.group_id and gm.user_id = auth.uid())
);

-- ---- 8. 채널 알림 음소거(20) ----
create table if not exists public.channel_mutes (
  user_id uuid not null references auth.users(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  primary key (user_id, team_id)
);
alter table public.channel_mutes enable row level security;
drop policy if exists cm_all on public.channel_mutes;
create policy cm_all on public.channel_mutes for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---- 9. 알림(14/18) ----
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null,
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
create policy nt_insert on public.notifications for insert with check (true);

-- ---- 10. 실시간 구독 (중복 안전) ----
do $$
begin
  alter publication supabase_realtime add table public.messages;
exception when others then null; end $$;
do $$
begin
  alter publication supabase_realtime add table public.message_reactions;
exception when others then null; end $$;
do $$
begin
  alter publication supabase_realtime add table public.doc_comments;
exception when others then null; end $$;
do $$
begin
  alter publication supabase_realtime add table public.meeting_requests;
exception when others then null; end $$;
do $$
begin
  alter publication supabase_realtime add table public.notifications;
exception when others then null; end $$;

-- ---- 11. 문서 이미지 스토리지(28) ----
insert into storage.buckets (id, name, public) values ('doc-images', 'doc-images', true)
on conflict (id) do nothing;
drop policy if exists dimg_read on storage.objects;
create policy dimg_read on storage.objects for select using (bucket_id = 'doc-images');
drop policy if exists dimg_write on storage.objects;
create policy dimg_write on storage.objects for insert to authenticated with check (bucket_id = 'doc-images');

-- ---- 12. 에이전트 기능 제거 — 관련 테이블 삭제 ----
-- 에이전트(산출물 생성기)는 서버 사양 제약으로 스코프에서 제외됨.
-- 남아있던 상태 테이블을 정리한다. (지식 어시스턴트 챗봇은 별개 기능으로 유지)
drop table if exists public.agent_messages cascade;
drop table if exists public.group_agents cascade;

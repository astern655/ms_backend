-- Minimal Supabase tables required by the backend RAG/P0 agent flow.
-- Run this in the Supabase SQL editor before using /api/rag/reindex.

create extension if not exists vector;

create table if not exists docs (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null,
  title text not null default 'Untitled',
  content text not null default '',
  scope text not null default 'group',
  parent_id uuid references docs(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists doc_chunks (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null,
  source text not null,
  content text not null,
  embedding vector(1536) not null,
  created_at timestamptz not null default now()
);

create index if not exists doc_chunks_group_id_idx on doc_chunks(group_id);
create index if not exists docs_group_id_idx on docs(group_id);

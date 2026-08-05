import OpenAI from 'openai'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const EMBED_MODEL = 'text-embedding-3-small' // 1536 dims
const CHAT_MODEL = 'gpt-4o-mini'
const CHUNK_SIZE = 900 // chars per chunk
const TOP_K = 6

let _db: SupabaseClient | null = null
function db(): SupabaseClient {
  if (_db) return _db
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set')
  _db = createClient(url, key, { auth: { persistSession: false } })
  return _db
}

// Pull readable text out of a doc's stored content (BlockNote JSON or plain text).
function docText(content: string): string {
  if (!content) return ''
  try {
    const blocks = JSON.parse(content)
    if (!Array.isArray(blocks)) return content
    const out: string[] = []
    const walk = (nodes: unknown[]) => {
      for (const n of nodes) {
        const node = n as { text?: string; content?: unknown[]; children?: unknown[] }
        if (typeof node.text === 'string') out.push(node.text)
        if (Array.isArray(node.content)) walk(node.content)
        if (Array.isArray(node.children)) walk(node.children)
      }
    }
    walk(blocks)
    return out.join(' ').replace(/\s+/g, ' ').trim()
  } catch {
    return content // legacy plain text
  }
}

function chunk(text: string): string[] {
  const out: string[] = []
  for (let i = 0; i < text.length; i += CHUNK_SIZE) out.push(text.slice(i, i + CHUNK_SIZE))
  return out
}

async function embed(openai: OpenAI, input: string[]): Promise<number[][]> {
  const r = await openai.embeddings.create({ model: EMBED_MODEL, input })
  return r.data.map((d) => d.embedding as number[])
}

// pgvector over PostgREST wants the string form "[1,2,3]".
const toVector = (v: number[]) => `[${v.join(',')}]`

function cosine(a: number[], b: number[]): number {
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1)
}

// Rebuild the chunk index for a whole group from its docs.
export async function reindexGroup(
  groupId: string,
  apiKey: string,
): Promise<{ docs: number; chunks: number }> {
  const openai = new OpenAI({ apiKey })
  const { data: docs, error } = await db()
    .from('docs')
    .select('id, title, content')
    .eq('group_id', groupId)
  if (error) throw new Error(error.message)

  const pieces: { source: string; content: string }[] = []
  for (const d of docs ?? []) {
    const title = (d.title as string) || '제목 없음'
    const body = docText(d.content as string)
    for (const c of chunk(body)) pieces.push({ source: title, content: c })
  }

  await db().from('doc_chunks').delete().eq('group_id', groupId)
  if (pieces.length === 0) return { docs: docs?.length ?? 0, chunks: 0 }

  const vectors = await embed(openai, pieces.map((p) => p.content))
  const rows = pieces.map((p, i) => ({
    group_id: groupId,
    source: p.source,
    content: p.content,
    embedding: toVector(vectors[i]),
  }))
  const { error: insErr } = await db().from('doc_chunks').insert(rows)
  if (insErr) throw new Error(insErr.message)
  return { docs: docs?.length ?? 0, chunks: rows.length }
}

type ChunkRow = { source: string; content: string; embedding: string }

// Retrieve the top-k doc chunks for a question as a context string + source list.
async function retrieve(
  groupId: string,
  question: string,
  openai: OpenAI,
): Promise<{ context: string; sources: string[] }> {
  const { data, error } = await db()
    .from('doc_chunks')
    .select('source, content, embedding')
    .eq('group_id', groupId)
  if (error) throw new Error(error.message)
  const chunks = (data ?? []) as ChunkRow[]
  if (chunks.length === 0) return { context: '', sources: [] }

  const [qv] = await embed(openai, [question])
  const scored = chunks
    .map((c) => ({ c, s: cosine(qv, JSON.parse(c.embedding) as number[]) }))
    .sort((a, b) => b.s - a.s)
    .slice(0, TOP_K)
  return {
    context: scored.map((x, i) => `[${i + 1}] (${x.c.source}) ${x.c.content}`).join('\n\n'),
    sources: [...new Set(scored.map((x) => x.c.source))],
  }
}

// ---- Agent (one per group) + session (one per team) ----

export type AgentSkills = {
  docs_rag: boolean
  summarize: boolean
  action_items: boolean
  translate: boolean
}
export type Agent = { group_id: string; name: string; system_prompt: string; skills: AgentSkills }

const DEFAULT_SKILLS: AgentSkills = {
  docs_rag: true,
  summarize: true,
  action_items: false,
  translate: false,
}
const SKILL_PROMPTS: Record<keyof AgentSkills, string> = {
  docs_rag: '- 팀의 문서·회의 기록(참고 자료)을 근거로 답하고, 없으면 모른다고 말해라.',
  summarize: '- 요청 시 핵심을 간결한 불릿으로 요약해라.',
  action_items: '- 대화·문서에 할 일이 있으면 "액션 아이템" 목록으로 정리해라.',
  translate: '- 사용자가 특정 언어를 요청하면 그 언어로 번역해 제공해라.',
}

export async function getAgent(groupId: string): Promise<Agent> {
  const { data, error } = await db()
    .from('group_agents')
    .select('*')
    .eq('group_id', groupId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (data) return data as Agent
  return { group_id: groupId, name: '팀 에이전트', system_prompt: '', skills: DEFAULT_SKILLS }
}

export async function saveAgent(
  groupId: string,
  fields: { name?: string; system_prompt?: string; skills?: AgentSkills },
): Promise<void> {
  const { error } = await db()
    .from('group_agents')
    .upsert({ group_id: groupId, ...fields, updated_at: new Date().toISOString() })
  if (error) throw new Error(error.message)
}

type SessionMsg = { role: 'user' | 'ai'; content: string; sources: string[] | null; ts: string }

// Agent config + a team's session history in one call.
export async function loadAgentView(
  groupId: string,
  teamId: string | null,
): Promise<{ agent: Agent; messages: SessionMsg[] }> {
  const agent = await getAgent(groupId)
  let messages: SessionMsg[] = []
  if (teamId) {
    const { data, error } = await db()
      .from('agent_messages')
      .select('role, content, sources, ts')
      .eq('team_id', teamId)
      .order('ts', { ascending: true })
      .limit(50)
    if (error) throw new Error(error.message)
    messages = (data ?? []) as SessionMsg[]
  }
  return { agent, messages }
}

// Answer as the group's agent, within a team's session (persisted if teamId given).
export async function askAgent(
  opts: { groupId: string; teamId: string | null; question: string; apiKey: string },
): Promise<{ answer: string; sources: string[] }> {
  const { groupId, teamId, question, apiKey } = opts
  const openai = new OpenAI({ apiKey })
  const agent = await getAgent(groupId)
  const skills = agent.skills ?? DEFAULT_SKILLS

  const history: { role: 'user' | 'assistant'; content: string }[] = []
  if (teamId) {
    const { data } = await db()
      .from('agent_messages')
      .select('role, content')
      .eq('team_id', teamId)
      .order('ts', { ascending: true })
      .limit(20)
    for (const m of data ?? [])
      history.push({ role: m.role === 'ai' ? 'assistant' : 'user', content: m.content as string })
  }

  let context = ''
  let sources: string[] = []
  if (skills.docs_rag) {
    const r = await retrieve(groupId, question, openai)
    context = r.context
    sources = r.sources
  }

  const skillLines = (Object.keys(SKILL_PROMPTS) as (keyof AgentSkills)[])
    .filter((k) => skills[k])
    .map((k) => SKILL_PROMPTS[k])
  const system = [
    `너는 "${agent.name}"라는 팀 협업 AI 에이전트다. 사용자의 언어로 간결하고 정확하게 답해라.`,
    agent.system_prompt?.trim() ? `역할: ${agent.system_prompt.trim()}` : '',
    ...skillLines,
  ]
    .filter(Boolean)
    .join('\n')

  const userContent = context ? `참고 자료:\n${context}\n\n질문: ${question}` : question
  const res = await openai.chat.completions.create({
    model: CHAT_MODEL,
    messages: [{ role: 'system', content: system }, ...history, { role: 'user', content: userContent }],
  })
  const answer = res.choices[0]?.message?.content?.trim() ?? ''

  if (teamId) {
    await db()
      .from('agent_messages')
      .insert([
        { team_id: teamId, group_id: groupId, role: 'user', content: question },
        { team_id: teamId, group_id: groupId, role: 'ai', content: answer, sources },
      ])
  }
  return { answer, sources }
}

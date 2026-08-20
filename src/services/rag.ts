import OpenAI from 'openai'
import { db } from '../lib/supabase.js'

const EMBED_MODEL = 'text-embedding-3-small' // 1536 dims
const CHAT_MODEL = 'gpt-4o-mini'
const CHUNK_SIZE = 900 // chars per chunk
const TOP_K = 6

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

// ---- Chatbot: lightweight, stateless RAG Q&A (low-level, token-cheap) ----

export async function askGroup(
  groupId: string,
  question: string,
  apiKey: string,
): Promise<{ answer: string; sources: string[] }> {
  const openai = new OpenAI({ apiKey })
  const { context, sources } = await retrieve(groupId, question, openai)
  if (!context) {
    return { answer: '아직 색인된 문서가 없습니다. 먼저 "다시 색인"을 눌러주세요.', sources: [] }
  }
  const res = await openai.chat.completions.create({
    model: CHAT_MODEL,
    messages: [
      {
        role: 'system',
        content:
          '너는 팀의 문서·회의 기록을 근거로 답하는 어시스턴트다. 아래 참고 자료만 근거로 사용자의 언어로 간결히 답하고, 없으면 모른다고 말해라.',
      },
      { role: 'user', content: `참고 자료:\n${context}\n\n질문: ${question}` },
    ],
  })
  return { answer: res.choices[0]?.message?.content?.trim() ?? '', sources }
}

// Agent (deliverable generator) removed — scoped out for the limited demo server.

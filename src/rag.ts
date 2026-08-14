import OpenAI from 'openai'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const EMBED_MODEL = 'text-embedding-3-small'
const CHAT_MODEL = 'gpt-4o-mini'
const CHUNK_SIZE = 900
const TOP_K = 8

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
    return content
  }
}

function chunk(text: string): string[] {
  const cleaned = text.replace(/\s+/g, ' ').trim()
  const out: string[] = []
  for (let i = 0; i < cleaned.length; i += CHUNK_SIZE) out.push(cleaned.slice(i, i + CHUNK_SIZE))
  return out
}

async function embed(openai: OpenAI, input: string[]): Promise<number[][]> {
  const r = await openai.embeddings.create({ model: EMBED_MODEL, input })
  return r.data.map((d) => d.embedding as number[])
}

// pgvector over PostgREST wants the string form "[1,2,3]".
const toVector = (v: number[]) => `[${v.join(',')}]`

function parseVector(value: string | number[]): number[] {
  if (Array.isArray(value)) return value
  return JSON.parse(value) as number[]
}

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

export async function reindexGroup(
  groupId: string,
  apiKey: string,
): Promise<{ docs: number; chunks: number }> {
  const openai = new OpenAI({ apiKey })
  const { data: docs, error } = await db()
    .from('docs')
    .select('id, title, content, scope')
    .eq('group_id', groupId)
  if (error) throw new Error(error.message)

  const pieces: { source: string; content: string }[] = []
  for (const d of docs ?? []) {
    const title = (d.title as string) || 'Untitled'
    const body = docText(String(d.content ?? ''))
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

type ChunkRow = { source: string; content: string; embedding: string | number[] }

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
    .map((c) => ({ c, s: cosine(qv, parseVector(c.embedding)) }))
    .sort((a, b) => b.s - a.s)
    .slice(0, TOP_K)
  return {
    context: scored.map((x, i) => `[${i + 1}] (${x.c.source}) ${x.c.content}`).join('\n\n'),
    sources: [...new Set(scored.map((x) => x.c.source))],
  }
}

export async function askGroup(
  groupId: string,
  question: string,
  apiKey: string,
): Promise<{ answer: string; sources: string[] }> {
  const openai = new OpenAI({ apiKey })
  const { context, sources } = await retrieve(groupId, question, openai)
  if (!context) {
    return { answer: '아직 색인된 문서가 없습니다. 먼저 다시 색인을 실행해 주세요.', sources: [] }
  }
  const res = await openai.chat.completions.create({
    model: CHAT_MODEL,
    messages: [
      {
        role: 'system',
        content:
          'You are Borderless, a company-context meeting execution assistant. Answer in Korean. Use only the provided company documents and meeting records as evidence. If evidence is missing, say what must be confirmed.',
      },
      { role: 'user', content: `Reference context:\n${context}\n\nQuestion: ${question}` },
    ],
    temperature: 0.2,
  })
  return { answer: res.choices[0]?.message?.content?.trim() ?? '', sources }
}

export type AgentMode =
  | 'meeting_summary'
  | 'decisions'
  | 'action_plan'
  | 'ppt_draft'
  | 'task_draft'
  | 'prd'
  | 'report'
  | 'plan'
  | 'design'
  | 'dev'

export type AgentSkill = {
  id: string
  label: string
  purpose: string
  instructions: string[]
}

export type AgentArtifact = {
  title: string
  content: string
  sources: string[]
  selectedSkills: AgentSkill[]
  mode: AgentMode
  status: 'draft' | 'ready_for_approval' | 'completed'
  artifactId?: string
  nextAction?: string
}

export type AgentPlan = AgentArtifact & {
  status: 'ready_for_approval'
}

export type MeetingDecision = {
  decision: string
  owner?: string
  dueDate?: string
  evidence?: string
  confidence?: 'high' | 'medium' | 'low'
  needsReview?: boolean
}

export type MeetingActionItem = {
  task: string
  owner?: string
  dueDate?: string
  priority?: 'P0' | 'P1' | 'P2'
  doneDefinition?: string
  evidence?: string
  needsReview?: boolean
}

export type MeetingStructure = {
  title: string
  summary: string
  decisions: MeetingDecision[]
  actionItems: MeetingActionItem[]
  unresolved: { item: string; owner?: string; dueDate?: string; reason?: string }[]
  requestedArtifacts: { type: 'notion' | 'jira' | 'ppt' | 'pdf' | 'other'; audience?: string; purpose?: string; notes?: string }[]
  risks: string[]
  sources: string[]
  selectedSkills: AgentSkill[]
}

type ModeSpec = {
  label: string
  guide: string
  qualityChecks: string[]
}

const SKILL_REGISTRY = {
  company_context: {
    id: 'company_context',
    label: 'Company context retrieval',
    purpose: 'Connect the meeting to company profile, product profile, glossary, brand tone, and past decisions.',
    instructions: [
      'Cite source document titles in the output.',
      'Separate facts supported by company documents from assumptions.',
      'Do not claim model fine-tuning; this MVP uses RAG over company documents.',
    ],
  },
  bilingual_structuring: {
    id: 'bilingual_structuring',
    label: 'Korean-English meeting structuring',
    purpose: 'Preserve business meaning from mixed Korean and English product discussions.',
    instructions: [
      'Keep product names, proper nouns, and work terms stable.',
      'Prioritize decisions, conditions, owners, and deadlines over literal translation.',
      'Separate spoken evidence from inferred follow-up work.',
    ],
  },
  decision_extraction: {
    id: 'decision_extraction',
    label: 'Decision, owner, deadline extraction',
    purpose: 'Separate confirmed decisions from unresolved or speculative items.',
    instructions: [
      'Extract decision, action item, owner, due date, evidence, confidence, and review need.',
      'If an owner or due date is absent, mark it as needsReview instead of inventing it.',
      'Do not treat brainstormed ideas as confirmed decisions.',
    ],
  },
  approval_planning: {
    id: 'approval_planning',
    label: 'Approval-gated execution planning',
    purpose: 'Prepare a user-reviewable plan before producing downstream artifacts.',
    instructions: [
      'Clearly separate what happens before approval and after approval.',
      'Never say external tools were updated unless an integration actually executed.',
      'List missing information that blocks confident execution.',
    ],
  },
  ppt_storyboard: {
    id: 'ppt_storyboard',
    label: 'PPT storyboard drafting',
    purpose: 'Turn decisions and company context into a presentation-ready draft.',
    instructions: [
      'For each slide, include title, key message, bullets, presenter note, and evidence.',
      'Separate customer-facing messaging from internal-only notes.',
      'Suggest visual treatment only when it helps explain timeline, owner, risk, or scope.',
    ],
  },
  task_drafting: {
    id: 'task_drafting',
    label: 'Notion and Jira task drafting',
    purpose: 'Convert action items into task drafts that are ready for human approval.',
    instructions: [
      'Include title, description, owner, due date, priority, acceptance criteria, and evidence.',
      'Label outputs as drafts unless a real Notion or Jira integration has executed.',
      'Mark ambiguous owner, due date, or scope as needsReview.',
    ],
  },
  risk_review: {
    id: 'risk_review',
    label: 'Risk and omission review',
    purpose: 'Find hallucination risk, missing information, and execution risk before approval.',
    instructions: [
      'Separate verified facts from assumptions.',
      'End with short review questions for the user.',
      'Keep hackathon demo output realistic: show roadmap items as future work, not completed integrations.',
    ],
  },
} satisfies Record<string, AgentSkill>

export function listAgentSkills(): AgentSkill[] {
  return Object.values(SKILL_REGISTRY)
}

function selectSkills(mode: AgentMode, status: AgentArtifact['status']): AgentSkill[] {
  const base = [
    SKILL_REGISTRY.company_context,
    SKILL_REGISTRY.bilingual_structuring,
    SKILL_REGISTRY.risk_review,
  ]
  if (mode === 'meeting_summary') return [...base, SKILL_REGISTRY.decision_extraction]
  if (mode === 'decisions') return [...base, SKILL_REGISTRY.decision_extraction, SKILL_REGISTRY.task_drafting]
  if (mode === 'action_plan' || status === 'ready_for_approval') {
    return [...base, SKILL_REGISTRY.decision_extraction, SKILL_REGISTRY.approval_planning]
  }
  if (mode === 'ppt_draft') {
    return [
      ...base,
      SKILL_REGISTRY.decision_extraction,
      SKILL_REGISTRY.approval_planning,
      SKILL_REGISTRY.ppt_storyboard,
    ]
  }
  if (mode === 'task_draft') {
    return [...base, SKILL_REGISTRY.decision_extraction, SKILL_REGISTRY.task_drafting]
  }
  return [...base, SKILL_REGISTRY.approval_planning]
}

const MODE_SPEC: Record<AgentMode, ModeSpec> = {
  meeting_summary: {
    label: 'Meeting summary',
    guide:
      'Create sections for summary, key agreements, confirmed decisions, action items, owners, deadlines, unresolved items, requested artifacts, and spoken evidence.',
    qualityChecks: [
      'Decisions and simple discussion notes are separated.',
      'Owners, due dates, and evidence are not invented.',
      'Mixed Korean-English business terms are preserved.',
    ],
  },
  decisions: {
    label: 'Decision extraction',
    guide:
      'Extract a decision table with decision, action item, owner, due date, evidence, confidence, and review need.',
    qualityChecks: [
      'Confirmed decisions, actions, and unresolved items are separated.',
      'Missing owners or due dates are marked as needsReview.',
      'The result is ready to become Notion or Jira drafts.',
    ],
  },
  action_plan: {
    label: 'Execution plan',
    guide:
      'Write the plan that the user must approve before any downstream artifact is generated. Include goal, context used, proposed steps, output artifacts, review questions, and what will happen after proceed.',
    qualityChecks: [
      'The approval boundary is explicit.',
      'The plan cites company context and meeting evidence.',
      'Review questions are listed before execution.',
    ],
  },
  ppt_draft: {
    label: 'PPT draft',
    guide:
      'Create a presentation draft with slide list, title, key message, bullets, presenter notes, evidence, and design direction.',
    qualityChecks: [
      'Every important slide is tied to a meeting decision or company document.',
      'Customer-facing and internal-only details are separated.',
      'The structure is concrete enough to build a deck.',
    ],
  },
  task_draft: {
    label: 'Task draft',
    guide:
      'Create Notion and Jira-ready task drafts with title, description, owner, due date, priority, acceptance criteria, linked evidence, and review need.',
    qualityChecks: [
      'Every task is executable by one owner.',
      'Owner, due date, and completion criteria are verifiable.',
      'The output is clearly labeled as a draft.',
    ],
  },
  prd: {
    label: 'PRD',
    guide:
      'Write a product requirements document with background, user problem, goal, target users, P0/P1 scope, functional requirements, success metrics, risks, and validation plan.',
    qualityChecks: [
      'The problem and solution connect back to evidence.',
      'P0, P1, and out-of-scope items are separated.',
      'Unvalidated claims are framed as hypotheses.',
    ],
  },
  report: {
    label: 'Report',
    guide: 'Write a report with summary, context, progress, decisions, issues, risks, and next steps.',
    qualityChecks: [
      'Summary and decisions are separated.',
      'Next steps are actionable.',
      'Risks and blockers are not omitted.',
    ],
  },
  plan: {
    label: 'Implementation plan',
    guide: 'Write an implementation plan with goal, milestones, WBS, owners if known, schedule, dependencies, risks, and verification.',
    qualityChecks: [
      'Work items are implementation-sized.',
      'Dependencies and schedule are realistic.',
      'Verification steps are included.',
    ],
  },
  design: {
    label: 'Design direction',
    guide:
      'Write design direction with concept, information architecture, key screens, component behavior, style guidance, and interaction notes.',
    qualityChecks: [
      'The target workflow is visible.',
      'Meeting execution artifacts shape the screens.',
      'The design scope can be prototyped.',
    ],
  },
  dev: {
    label: 'Backend specification',
    guide:
      'Write a development specification with architecture, data model, APIs, implementation tasks, environment variables, deployment notes, and tests.',
    qualityChecks: [
      'The API contract matches the current codebase.',
      'Environment and deployment dependencies are explicit.',
      'Test and verification steps are included.',
    ],
  },
}

function titleFromMarkdown(content: string, fallback: string): string {
  const firstLine = content.split('\n').find((line) => line.trim()) ?? ''
  return firstLine.replace(/^#+\s*/, '').trim() || fallback
}

function formatSkills(skills: AgentSkill[]): string {
  return skills
    .map(
      (skill, index) =>
        `${index + 1}. ${skill.label} (${skill.id})\n- Purpose: ${skill.purpose}\n- Rules: ${skill.instructions.join(' / ')}`,
    )
    .join('\n')
}

function buildP0System(spec: ModeSpec, skills: AgentSkill[]): string {
  return [
    'You are Borderless, a company-context multilingual meeting execution agent.',
    'The product goal is to turn Korean-English product meetings into confirmed decisions, owners, deadlines, unresolved items, and downstream draft artifacts.',
    'Use RAG over the supplied company/product/meeting documents. Do not claim fine-tuning or hidden company knowledge.',
    'Before approval, only propose a plan. After approval, generate drafts. Never claim that Notion, Jira, PPT, or PDF was actually created unless this backend performed that integration.',
    'Write the final output in Korean Markdown. Preserve product names, people names, and important English business terms.',
    'Separate verified facts from assumptions. Mark missing owners, dates, and unclear scope as items that need review.',
    'Always include sections named "사용 스킬", "품질 체크", and "확인 필요".',
    `Active skills:\n${formatSkills(skills)}`,
    `Quality checklist:\n- ${spec.qualityChecks.join('\n- ')}`,
    `Mode guide: ${spec.guide}`,
  ].join('\n')
}

function parseJsonObject<T>(raw: string): T {
  const trimmed = raw.trim()
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
  const candidate = fenced?.[1] ?? trimmed.slice(trimmed.indexOf('{'), trimmed.lastIndexOf('}') + 1)
  if (!candidate || !candidate.startsWith('{')) throw new Error('No JSON object found in model response')
  return JSON.parse(candidate) as T
}

function arrayValue<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : []
}

function stringValue(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

async function generateArtifact(opts: {
  groupId: string
  mode: AgentMode
  direction: string
  meetingTranscript?: string
  executionPlan?: string
  apiKey: string
  status: AgentArtifact['status']
}): Promise<AgentArtifact> {
  const { groupId, mode, direction, meetingTranscript, executionPlan, apiKey, status } = opts
  const spec = MODE_SPEC[mode]
  if (!spec) throw new Error(`unknown mode: ${mode}`)
  const openai = new OpenAI({ apiKey })
  const selectedSkills = selectSkills(mode, status)

  const query = [spec.label, direction, meetingTranscript].filter(Boolean).join('\n')
  const { context, sources } = await retrieve(groupId, query || spec.label, openai)
  const user = [
    context ? `Company knowledge search results:\n${context}` : 'Company knowledge search results: no indexed document found.',
    meetingTranscript ? `\nMeeting transcript or memo:\n${meetingTranscript}` : '',
    executionPlan ? `\nApproved execution plan:\n${executionPlan}` : '',
    `\nUser direction:\n${direction || '(No additional direction provided.)'}`,
    `\nCreate the ${spec.label} from the information above.`,
  ]
    .filter(Boolean)
    .join('\n')

  const res = await openai.chat.completions.create({
    model: CHAT_MODEL,
    messages: [
      { role: 'system', content: buildP0System(spec, selectedSkills) },
      { role: 'user', content: user },
    ],
    temperature: 0.2,
  })
  const content = res.choices[0]?.message?.content?.trim() ?? ''
  return {
    title: titleFromMarkdown(content, `${spec.label} draft`),
    content,
    sources,
    selectedSkills,
    mode,
    status,
    nextAction:
      status === 'ready_for_approval'
        ? '사용자가 내용을 확인한 뒤 proceed를 승인해야 산출물 초안이 생성됩니다.'
        : undefined,
  }
}

async function saveArtifactDoc(groupId: string, artifact: AgentArtifact): Promise<string> {
  const content = [
    artifact.content,
    '',
    '---',
    `mode: ${artifact.mode}`,
    `status: ${artifact.status}`,
    artifact.sources.length ? `sources: ${artifact.sources.join(', ')}` : 'sources: none',
  ].join('\n')

  const { data, error } = await db()
    .from('docs')
    .insert({
      group_id: groupId,
      scope: 'group',
      title: `[Agent] ${artifact.title}`,
      content,
    })
    .select('id')
    .single()
  if (error) throw new Error(error.message)
  const id = (data as { id?: string } | null)?.id
  if (!id) throw new Error('artifact was saved but no id was returned')
  return id
}

export async function runAgent(opts: {
  groupId: string
  mode: AgentMode
  direction: string
  apiKey: string
  meetingTranscript?: string
}): Promise<AgentArtifact> {
  return generateArtifact({
    ...opts,
    status: 'completed',
  })
}

export async function structureMeeting(opts: {
  groupId: string
  direction: string
  apiKey: string
  meetingTranscript: string
}): Promise<MeetingStructure> {
  const { groupId, direction, meetingTranscript, apiKey } = opts
  const openai = new OpenAI({ apiKey })
  const selectedSkills = selectSkills('decisions', 'draft')
  const { context, sources } = await retrieve(
    groupId,
    [direction, meetingTranscript, 'decisions owners deadlines unresolved artifacts risks'].join('\n'),
    openai,
  )

  const res = await openai.chat.completions.create({
    model: CHAT_MODEL,
    messages: [
      {
        role: 'system',
        content: [
          'You are Borderless. Convert a Korean-English product meeting into a strict JSON object for backend consumption.',
          'Return JSON only. Do not wrap it in Markdown.',
          'Do not invent owners, due dates, or facts. Use needsReview when information is missing or inferred.',
          'Keep the business output in Korean, while preserving product names and English work terms.',
          `Active skills:\n${formatSkills(selectedSkills)}`,
        ].join('\n'),
      },
      {
        role: 'user',
        content: [
          'Company knowledge search results:',
          context || '(no indexed document found)',
          '',
          'Meeting transcript:',
          meetingTranscript,
          '',
          'User direction:',
          direction || '(none)',
          '',
          'Required JSON shape:',
          JSON.stringify(
            {
              title: 'string',
              summary: 'string',
              decisions: [
                {
                  decision: 'string',
                  owner: 'string or empty when unknown',
                  dueDate: 'YYYY-MM-DD or natural date or empty when unknown',
                  evidence: 'spoken evidence',
                  confidence: 'high | medium | low',
                  needsReview: true,
                },
              ],
              actionItems: [
                {
                  task: 'string',
                  owner: 'string or empty when unknown',
                  dueDate: 'YYYY-MM-DD or natural date or empty when unknown',
                  priority: 'P0 | P1 | P2',
                  doneDefinition: 'string',
                  evidence: 'spoken evidence',
                  needsReview: true,
                },
              ],
              unresolved: [{ item: 'string', owner: 'string', dueDate: 'string', reason: 'string' }],
              requestedArtifacts: [{ type: 'ppt', audience: 'string', purpose: 'string', notes: 'string' }],
              risks: ['string'],
            },
            null,
            2,
          ),
        ].join('\n'),
      },
    ],
    temperature: 0.1,
  })

  const raw = res.choices[0]?.message?.content?.trim() ?? ''
  const parsed = parseJsonObject<Partial<MeetingStructure>>(raw)
  return {
    title: stringValue(parsed.title, '회의 구조화 결과'),
    summary: stringValue(parsed.summary),
    decisions: arrayValue<MeetingDecision>(parsed.decisions),
    actionItems: arrayValue<MeetingActionItem>(parsed.actionItems),
    unresolved: arrayValue<{ item: string; owner?: string; dueDate?: string; reason?: string }>(parsed.unresolved),
    requestedArtifacts: arrayValue<{
      type: 'notion' | 'jira' | 'ppt' | 'pdf' | 'other'
      audience?: string
      purpose?: string
      notes?: string
    }>(parsed.requestedArtifacts),
    risks: arrayValue<string>(parsed.risks),
    sources,
    selectedSkills,
  }
}

export async function proposeExecutionPlan(opts: {
  groupId: string
  direction: string
  apiKey: string
  meetingTranscript?: string
}): Promise<AgentPlan> {
  const artifact = await generateArtifact({
    ...opts,
    mode: 'action_plan',
    status: 'ready_for_approval',
  })
  return artifact as AgentPlan
}

export async function proceedAgent(opts: {
  groupId: string
  direction: string
  apiKey: string
  mode?: AgentMode
  meetingTranscript?: string
  executionPlan?: string
}): Promise<AgentArtifact> {
  const artifact = await generateArtifact({
    ...opts,
    mode: opts.mode ?? 'ppt_draft',
    status: 'completed',
  })
  artifact.artifactId = await saveArtifactDoc(opts.groupId, artifact)
  return artifact
}

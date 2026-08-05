import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import { AccessToken } from 'livekit-server-sdk'
import { transcribeAndTranslate } from './stt.js'
import { reindexGroup, askAgent, saveAgent, loadAgentView } from './rag.js'

const { LIVEKIT_API_KEY, LIVEKIT_API_SECRET, OPENAI_API_KEY } = process.env
const PORT = Number(process.env.PORT ?? 3001)

const app = express()
app.use(cors())
app.use(express.json({ limit: '1mb' }))

app.get('/health', (_req, res) => {
  res.json({ ok: true })
})

// LiveKit access token for a given room + identity.
app.get('/api/token', async (req, res) => {
  const room = String(req.query.room ?? '')
  const identity = String(req.query.identity ?? '')
  const name = String(req.query.name ?? '')
  if (!room || !identity) {
    res.status(400).json({ error: 'room and identity required' })
    return
  }
  if (!LIVEKIT_API_KEY || !LIVEKIT_API_SECRET) {
    res.status(500).json({ error: 'LIVEKIT_API_KEY / LIVEKIT_API_SECRET not set' })
    return
  }
  const at = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
    identity,
    name: name || undefined,
  })
  at.addGrant({ roomJoin: true, room, canPublish: true, canSubscribe: true })
  res.json({ token: await at.toJwt() })
})

// One audio chunk (raw body) -> OpenAI STT + translation.
app.post('/api/stt', express.raw({ type: '*/*', limit: '25mb' }), async (req, res) => {
  const sourceLang = String(req.query.sourceLang ?? 'ko')
  const targetLangs = String(req.query.targetLangs ?? 'ko,en')
    .split(',')
    .filter(Boolean)
  if (!OPENAI_API_KEY) {
    res.status(500).json({ error: 'OPENAI_API_KEY not set' })
    return
  }
  try {
    const out = await transcribeAndTranslate(req.body as Buffer, {
      sourceLang,
      targetLangs,
      apiKey: OPENAI_API_KEY,
    })
    res.json(out)
  } catch (e) {
    res.status(500).json({ error: (e as Error).message })
  }
})

// Rebuild the knowledge-base index for a group's docs.
app.post('/api/rag/reindex', async (req, res) => {
  const groupId = String(req.query.group ?? (req.body?.groupId as string) ?? '')
  if (!groupId) {
    res.status(400).json({ error: 'group required' })
    return
  }
  if (!OPENAI_API_KEY) {
    res.status(500).json({ error: 'OPENAI_API_KEY not set' })
    return
  }
  try {
    res.json(await reindexGroup(groupId, OPENAI_API_KEY))
  } catch (e) {
    res.status(500).json({ error: (e as Error).message })
  }
})

// Agent config (per group) + a team's session history.
app.get('/api/agent', async (req, res) => {
  const groupId = String(req.query.group ?? '')
  const teamId = req.query.team ? String(req.query.team) : null
  if (!groupId) {
    res.status(400).json({ error: 'group required' })
    return
  }
  try {
    res.json(await loadAgentView(groupId, teamId))
  } catch (e) {
    res.status(500).json({ error: (e as Error).message })
  }
})

// Save the group's agent config (name / skills).
app.post('/api/agent/config', async (req, res) => {
  const groupId = String(req.body?.groupId ?? '')
  if (!groupId) {
    res.status(400).json({ error: 'groupId required' })
    return
  }
  try {
    await saveAgent(groupId, {
      name: req.body?.name,
      system_prompt: req.body?.systemPrompt,
      skills: req.body?.skills,
    })
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: (e as Error).message })
  }
})

// Ask the group's agent within a team session (persisted if teamId given).
app.post('/api/agent/ask', async (req, res) => {
  const groupId = String(req.body?.groupId ?? '')
  const teamId = req.body?.teamId ? String(req.body.teamId) : null
  const question = String(req.body?.question ?? '').trim()
  if (!groupId || !question) {
    res.status(400).json({ error: 'groupId and question required' })
    return
  }
  if (!OPENAI_API_KEY) {
    res.status(500).json({ error: 'OPENAI_API_KEY not set' })
    return
  }
  try {
    res.json(await askAgent({ groupId, teamId, question, apiKey: OPENAI_API_KEY }))
  } catch (e) {
    res.status(500).json({ error: (e as Error).message })
  }
})

app.listen(PORT, () => {
  console.log(`Borderless backend on http://localhost:${PORT}`)
})

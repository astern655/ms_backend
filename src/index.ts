import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import { AccessToken } from 'livekit-server-sdk'
import { transcribeAndTranslate } from './stt.js'

const { LIVEKIT_API_KEY, LIVEKIT_API_SECRET, OPENAI_API_KEY } = process.env
const PORT = Number(process.env.PORT ?? 3001)

const app = express()
app.use(cors())

app.get('/health', (_req, res) => {
  res.json({ ok: true })
})

// LiveKit access token for a given room + identity.
app.get('/api/token', async (req, res) => {
  const room = String(req.query.room ?? '')
  const identity = String(req.query.identity ?? '')
  if (!room || !identity) {
    res.status(400).json({ error: 'room and identity required' })
    return
  }
  if (!LIVEKIT_API_KEY || !LIVEKIT_API_SECRET) {
    res.status(500).json({ error: 'LIVEKIT_API_KEY / LIVEKIT_API_SECRET not set' })
    return
  }
  const at = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, { identity })
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

app.listen(PORT, () => {
  console.log(`Borderless backend on http://localhost:${PORT}`)
})

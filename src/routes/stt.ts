import { Router, raw } from 'express'
import { transcribeAndTranslate } from '../services/stt.js'

export const sttRouter = Router()

// One audio chunk (raw body) -> OpenAI STT + translation.
sttRouter.post('/api/stt', raw({ type: '*/*', limit: '25mb' }), async (req, res) => {
  const sourceLang = String(req.query.sourceLang ?? 'ko')
  const targetLangs = String(req.query.targetLangs ?? 'ko,en')
    .split(',')
    .filter(Boolean)
  const { OPENAI_API_KEY } = process.env
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

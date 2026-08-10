import { Router } from 'express'
import { runAgent, type AgentMode } from '../services/rag.js'

export const agentRouter = Router()

// Agent: generate a deliverable (PRD / report / plan / design / dev) from records + direction.
agentRouter.post('/api/agent/run', async (req, res) => {
  const groupId = String(req.body?.groupId ?? '')
  const mode = String(req.body?.mode ?? '') as AgentMode
  const direction = String(req.body?.direction ?? '').trim()
  const { OPENAI_API_KEY } = process.env
  if (!groupId || !mode) {
    res.status(400).json({ error: 'groupId and mode required' })
    return
  }
  if (!OPENAI_API_KEY) {
    res.status(500).json({ error: 'OPENAI_API_KEY not set' })
    return
  }
  try {
    res.json(await runAgent({ groupId, mode, direction, apiKey: OPENAI_API_KEY }))
  } catch (e) {
    res.status(500).json({ error: (e as Error).message })
  }
})

import { Router } from 'express'
import { reindexGroup, askGroup } from '../services/rag.js'

export const ragRouter = Router()

// Rebuild the knowledge-base index for a group's docs.
ragRouter.post('/api/rag/reindex', async (req, res) => {
  const groupId = String(req.query.group ?? (req.body?.groupId as string) ?? '')
  const { OPENAI_API_KEY } = process.env
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

// Chatbot: lightweight RAG Q&A.
ragRouter.post('/api/rag/ask', async (req, res) => {
  const groupId = String(req.body?.groupId ?? '')
  const question = String(req.body?.question ?? '').trim()
  const { OPENAI_API_KEY } = process.env
  if (!groupId || !question) {
    res.status(400).json({ error: 'groupId and question required' })
    return
  }
  if (!OPENAI_API_KEY) {
    res.status(500).json({ error: 'OPENAI_API_KEY not set' })
    return
  }
  try {
    res.json(await askGroup(groupId, question, OPENAI_API_KEY))
  } catch (e) {
    res.status(500).json({ error: (e as Error).message })
  }
})

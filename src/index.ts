import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import { tokenRouter } from './routes/token.js'
import { sttRouter } from './routes/stt.js'
import { ragRouter } from './routes/rag.js'
import { roomRouter } from './routes/room.js'

const PORT = Number(process.env.PORT ?? 3001)

const app = express()
app.use(cors())
app.use(express.json({ limit: '1mb' }))

app.get('/health', (_req, res) => {
  res.json({ ok: true })
})

app.use(tokenRouter)
app.use(sttRouter)
app.use(ragRouter)
app.use(roomRouter)

app.listen(PORT, () => {
  console.log(`Borderless backend on http://localhost:${PORT}`)
})

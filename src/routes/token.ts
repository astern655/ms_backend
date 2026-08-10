import { Router } from 'express'
import { AccessToken } from 'livekit-server-sdk'

export const tokenRouter = Router()

// LiveKit access token for a given room + identity.
tokenRouter.get('/api/token', async (req, res) => {
  const room = String(req.query.room ?? '')
  const identity = String(req.query.identity ?? '')
  const name = String(req.query.name ?? '')
  const { LIVEKIT_API_KEY, LIVEKIT_API_SECRET } = process.env
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

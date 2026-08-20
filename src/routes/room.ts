import { Router } from 'express'
import { RoomServiceClient, TrackSource } from 'livekit-server-sdk'

export const roomRouter = Router()

function svc(): RoomServiceClient | null {
  const { LIVEKIT_API_KEY, LIVEKIT_API_SECRET, LIVEKIT_URL } = process.env
  if (!LIVEKIT_API_KEY || !LIVEKIT_API_SECRET || !LIVEKIT_URL) return null
  // RoomServiceClient wants the https host; accept the wss project URL and convert.
  const host = LIVEKIT_URL.replace(/^wss:/, 'https:').replace(/^ws:/, 'http:')
  return new RoomServiceClient(host, LIVEKIT_API_KEY, LIVEKIT_API_SECRET)
}

// Host control: mute a participant's microphone.
roomRouter.post('/api/room/mute', async (req, res) => {
  const { room, identity } = req.body as { room?: string; identity?: string }
  const client = svc()
  if (!client) {
    res.status(500).json({ error: 'LIVEKIT_URL / LIVEKIT_API_KEY / LIVEKIT_API_SECRET not set' })
    return
  }
  if (!room || !identity) {
    res.status(400).json({ error: 'room and identity required' })
    return
  }
  try {
    const p = await client.getParticipant(room, identity)
    const mic = p.tracks.find((t) => t.source === TrackSource.MICROPHONE)
    if (mic) await client.mutePublishedTrack(room, identity, mic.sid, true)
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: (e as Error).message })
  }
})

// Host control: remove a participant from the room.
roomRouter.post('/api/room/remove', async (req, res) => {
  const { room, identity } = req.body as { room?: string; identity?: string }
  const client = svc()
  if (!client) {
    res.status(500).json({ error: 'LIVEKIT_URL / LIVEKIT_API_KEY / LIVEKIT_API_SECRET not set' })
    return
  }
  if (!room || !identity) {
    res.status(400).json({ error: 'room and identity required' })
    return
  }
  try {
    await client.removeParticipant(room, identity)
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: (e as Error).message })
  }
})

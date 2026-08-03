# Borderless — Backend

토큰 발급(LiveKit)과 실시간 STT+번역(OpenAI)을 제공하는 Express 서비스. 프런트엔드는 [ms_front](https://github.com/astern655/ms_front).

## API
- `GET /api/token?room=&identity=` → `{ token }` (LiveKit access token)
- `POST /api/stt?sourceLang=&targetLangs=` (body: audio, octet-stream) → `{ sourceText, translations }`
- `GET /health` → `{ ok: true }`

## 실행

```bash
npm install
cp .env.example .env   # 값 채우기
npm run dev            # http://localhost:3001
```

배포: `npm run build && npm start`.

`.env`:
- `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` — LiveKit Cloud API 키
- `OPENAI_API_KEY` — OpenAI 키 (STT+번역)
- `PORT` — 기본 3001

## 스택
Express 5 + TypeScript, `livekit-server-sdk`, `openai`. STT: `gpt-4o-transcribe`, 번역: `gpt-4o-mini`.

# Borderless — Backend

Express backend for Borderless. It provides LiveKit token issuance, OpenAI STT/translation, Supabase-backed RAG, and the P0 meeting execution agent flow.

## API

- `GET /health` -> `{ ok: true }`
- `GET /api/token?room=&identity=&name=` -> `{ token }`
- `POST /api/stt?sourceLang=&targetLangs=` -> `{ sourceText, translations }`
- `POST /api/rag/reindex?group=` -> `{ docs, chunks }`
- `POST /api/rag/ask` -> `{ answer, sources }`
- `GET /api/agent/skills` -> configured agent skill registry
- `POST /api/agent/run` -> backward-compatible direct artifact generation
- `POST /api/agent/plan` -> structures meeting context and returns an execution plan for approval
- `POST /api/meetings/structure` -> returns machine-readable decisions, owners, deadlines, unresolved items, artifacts, and risks
- `POST /api/agent/proceed` -> requires `approved=true` or `approval="proceed"`, generates the approved artifact, and stores it in `docs`

### P0 agent flow

1. Save company/product/meeting notes into Supabase `docs`.
2. Call `/api/rag/reindex` for the group.
3. Call `/api/agent/plan` with `groupId`, `direction`, and optional `meetingTranscript`.
4. Let the user review the plan.
5. Optionally call `/api/meetings/structure` when the frontend needs structured decision data.
6. Call `/api/agent/proceed` after approval. The default output mode is `ppt_draft`; the response includes `artifactId` after saving the draft back into Supabase `docs`.

The minimum Supabase tables for this backend are in `supabase/p0-agent-schema.sql`.

Supported agent modes:

- `meeting_summary`
- `decisions`
- `action_plan`
- `ppt_draft`
- `task_draft`
- legacy modes: `prd`, `report`, `plan`, `design`, `dev`

Configured skills:

- company context retrieval
- bilingual meeting structuring
- decision/owner/deadline extraction
- approval-gated planning
- PPT storyboard drafting
- Notion/Jira task drafting
- risk and missing-information review

## Run

```bash
npm install
cp .env.example .env
npm run dev
```

PowerShell:

```powershell
npm install
Copy-Item .env.example .env
npm run dev
```

Build and start:

```bash
npm run build
npm start
```

## Environment

- `LIVEKIT_API_KEY`
- `LIVEKIT_API_SECRET`
- `OPENAI_API_KEY`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `PORT` defaults to `3001`

## Stack

Express 5 + TypeScript, LiveKit server SDK, OpenAI SDK, Supabase JS.

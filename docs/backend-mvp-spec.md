# Borderless Backend MVP Spec

## 1. 기준 자료와 해석 범위

이 문서는 PRD, Manyfast 기능명세서 이미지, 회의록, 현재 프론트/백엔드 코드를 기준으로 정리한 백엔드 MVP 명세다.

첨부된 Claude 스킬 표는 제품 요구사항이 아니라 개발 방식과 구현 아이디어 참고 자료로만 사용한다. 즉 `graphify`, `memory-vault`, `document-skills:pptx` 같은 항목을 그대로 설치해야 한다는 뜻이 아니라, Borderless 백엔드에 맞는 형태로 RAG, 구조화, 산출물 저장, 검증 흐름에 반영한다.

## 2. P0 사용자 시나리오

PM이 회사 프로파일, 제품 프로파일, 업무 용어, 브랜드 톤, 회의 기록을 워크스페이스에 저장한다. 백엔드는 해당 문서를 색인하고, 한영 혼합 회의 transcript를 회사 맥락과 함께 분석한다. 에이전트는 결정사항, 담당자, 기한, 미확정 사항, 요청 산출물을 구조화하고 실행 계획을 먼저 제안한다. 사용자가 승인하면 PPT 초안 또는 태스크 초안을 생성하고, 결과를 다시 회사 지식 DB에 저장한다.

P0에서 실제 외부 Notion/Jira/PPT/PDF 파일 생성을 완료했다고 표현하면 안 된다. 현재 MVP의 안전한 표현은 "Notion/Jira/PPT/PDF 초안 생성"이다.

## 3. 현재 백엔드에 반영된 기능

### 3.1 RAG 색인

- `POST /api/rag/reindex`
- Supabase `docs`의 문서를 읽어 `doc_chunks`에 임베딩 저장
- OpenAI `text-embedding-3-small` 사용
- 회사/제품/회의 문서를 같은 `groupId` 기준으로 검색

### 3.2 RAG 질의응답

- `POST /api/rag/ask`
- 색인된 회사 문서와 회의 기록 기반으로 한국어 답변
- 근거가 부족하면 추가 확인이 필요하다고 응답하도록 프롬프트 정리

### 3.3 에이전트 스킬 레지스트리

- `GET /api/agent/skills`
- 현재 스킬:
  - `company_context`
  - `bilingual_structuring`
  - `decision_extraction`
  - `approval_planning`
  - `ppt_storyboard`
  - `task_drafting`
  - `risk_review`

### 3.4 승인 기반 실행 흐름

- `POST /api/agent/plan`
- 승인 전 실행 계획만 생성
- `POST /api/agent/proceed`
- `approved=true` 또는 `approval="proceed"`가 있어야 산출물 생성
- 승인 후 생성된 산출물은 Supabase `docs`에 `[Agent] ...` 문서로 저장
- 응답에 `artifactId` 포함

### 3.5 회의 구조화 API

- `POST /api/meetings/structure`
- 한영 혼합 회의 transcript를 JSON으로 구조화
- 응답 필드:
  - `title`
  - `summary`
  - `decisions`
  - `actionItems`
  - `unresolved`
  - `requestedArtifacts`
  - `risks`
  - `sources`
  - `selectedSkills`

### 3.6 해커톤 데모 시드

- `POST /api/demo/seed`
- NovaCloud/LaunchOps 예시 회사 프로파일, 제품 프로파일, 용어집, 한영 회의 기록을 `docs`에 저장
- 데모 직후 `/api/rag/reindex`를 호출하면 바로 P0 플로우 테스트 가능

## 4. 아직 MVP로 보완해야 하는 백엔드 기능

### 4.1 인증/권한 검증

현재 백엔드 API는 `groupId`만 받으면 해당 그룹 문서를 조회한다. Supabase service role key를 쓰기 때문에 서버 내부에서는 RLS를 우회한다. 실제 배포 MVP에서는 요청 사용자가 해당 `groupId` 멤버인지 확인해야 한다.

권장 구현:

- 프론트 Supabase access token을 `Authorization: Bearer <token>`으로 백엔드에 전달
- 백엔드에서 Supabase auth로 사용자 검증
- `group_members` 기준으로 그룹 접근 권한 확인
- 권한 실패 시 `403`

### 4.2 회의 실행 기록 테이블

현재 산출물은 `docs`에 저장되지만, "어떤 회의에서 어떤 구조화 결과와 승인 흐름이 발생했는지"를 별도 추적하지 않는다.

권장 테이블:

- `meeting_runs`
  - `id`
  - `group_id`
  - `title`
  - `raw_transcript`
  - `structured_json`
  - `status`
  - `created_by`
  - `created_at`
- `agent_runs`
  - `id`
  - `group_id`
  - `meeting_run_id`
  - `mode`
  - `approval_status`
  - `input`
  - `output`
  - `artifact_doc_id`
  - `created_at`

### 4.3 실제 태스크/문서 연동

P0 발표에서는 초안 생성까지로도 충분하지만, 제품 완성도를 높이려면 다음이 필요하다.

- Notion task draft -> 실제 Notion page/database insert
- Jira task draft -> 실제 Jira issue create
- PPT draft -> `.pptx` 파일 생성
- PDF draft -> `.pdf` 파일 생성

우선순위는 PPT 파일 생성보다 Notion/Jira 실제 등록이 더 높다. PRD의 핵심은 "회의 결정이 실제 업무로 이어지는 것"이기 때문이다.

### 4.4 정확도 검증 세트

심사에서 "그럴듯한 AI 요약"으로 보이면 약하다. 최소 3개 샘플 회의에 대해 expected JSON을 만들어야 한다.

검증 항목:

- 결정사항 보존율
- 담당자 추출 정확도
- 기한 추출 정확도
- 미확정 항목 분리율
- 회사 문서 근거 반영 여부

### 4.5 비용/지연 관리

현재 구조는 색인과 생성 요청이 동기식이다. 데모에는 충분하지만 운영 MVP에서는 필요하다.

- 긴 transcript 청크 분할
- 요청별 token 사용량 로깅
- timeout/retry
- background job queue
- 모델별 fallback

## 5. Claude 스킬과 Codex/백엔드 적용 매핑

| Claude 스킬 | 백엔드 적용 방향 | 현재 반영 |
| --- | --- | --- |
| `graphify` | 회의 결정, 담당자, 산출물 요청을 구조화 JSON/관계 데이터로 변환 | `/api/meetings/structure` |
| `memory-vault` | 회의 기록과 산출물을 회사 지식 DB에 누적 | `docs`, `doc_chunks`, 승인 산출물 저장 |
| `claude-mem:knowledge-agent` | 회사 문서 기반 질의응답/생성 | RAG 검색 + 스킬 프롬프트 |
| `claude-mem:make-plan` | 승인 전 실행 계획 생성 | `/api/agent/plan` |
| `claude-mem:do` | 승인 후 산출물 생성 | `/api/agent/proceed` |
| `document-skills:pptx` | 실제 PPT 파일 생성 | 아직 미구현, 다음 단계 후보 |
| `superpowers:test-driven-development` | 구조화 결과 expected JSON 테스트 | 아직 미구현 |
| `superpowers:verification-before-completion` | 빌드/스모크 테스트 강제 | `npm run build`로 검증 |
| `code-review` / `security-review` | PR 전 권한/보안 리뷰 | 다음 단계 후보 |

Codex에서 바로 적용 가능한 쪽은 RAG 구조화, 명세 문서화, 테스트/검증, 보안 리뷰다. 실제 PPT/PDF 파일 생성은 Codex의 문서/프레젠테이션 능력과 맞지만, 서비스 백엔드에 넣으려면 `pptxgenjs`, `pdf-lib`, `puppeteer` 같은 런타임 의존성을 별도로 선택해야 한다.

## 6. API 명세

### `POST /api/demo/seed`

요청:

```json
{
  "groupId": "uuid"
}
```

응답:

```json
{
  "docs": 4,
  "titles": ["..."],
  "direction": "...",
  "meetingTranscript": "..."
}
```

### `POST /api/rag/reindex?group=<groupId>`

응답:

```json
{
  "docs": 4,
  "chunks": 8
}
```

### `POST /api/meetings/structure`

요청:

```json
{
  "groupId": "uuid",
  "direction": "고객 공유용 Launch Plan PPT와 실행 태스크를 만들어줘.",
  "meetingTranscript": "[PM / ko] ..."
}
```

응답:

```json
{
  "title": "회의 구조화 결과",
  "summary": "...",
  "decisions": [
    {
      "decision": "...",
      "owner": "...",
      "dueDate": "...",
      "evidence": "...",
      "confidence": "high",
      "needsReview": false
    }
  ],
  "actionItems": [],
  "unresolved": [],
  "requestedArtifacts": [],
  "risks": [],
  "sources": [],
  "selectedSkills": []
}
```

### `POST /api/agent/plan`

요청:

```json
{
  "groupId": "uuid",
  "direction": "고객 공유용 Launch Plan PPT 초안을 만들어줘.",
  "meetingTranscript": "[PM / ko] ..."
}
```

응답:

```json
{
  "title": "...",
  "content": "...",
  "sources": ["..."],
  "selectedSkills": ["..."],
  "mode": "action_plan",
  "status": "ready_for_approval",
  "nextAction": "..."
}
```

### `POST /api/agent/proceed`

요청:

```json
{
  "groupId": "uuid",
  "approval": "proceed",
  "mode": "ppt_draft",
  "direction": "고객 공유용 Launch Plan PPT 초안을 만들어줘.",
  "meetingTranscript": "[PM / ko] ...",
  "executionPlan": "승인된 실행 계획 markdown"
}
```

응답:

```json
{
  "title": "...",
  "content": "...",
  "sources": ["..."],
  "selectedSkills": ["..."],
  "mode": "ppt_draft",
  "status": "completed",
  "artifactId": "saved-doc-uuid"
}
```

## 7. 커밋 단위 제안

커밋은 사용자가 직접 수행한다. 현재 변경분은 아래처럼 나누면 리뷰가 쉽다.

### Commit 1: backend: add Supabase RAG schema and env config

포함 파일:

- `.env.example`
- `render.yaml`
- `supabase/p0-agent-schema.sql`
- `README.md`의 환경변수/스키마 설명 일부

목적:

- Render/AWS 배포 시 필요한 Supabase 환경변수와 최소 DB 스키마를 명확히 한다.

### Commit 2: backend: implement P0 agent skills and approval flow

포함 파일:

- `src/rag.ts`
- `src/index.ts`

목적:

- 깨진 프롬프트 제거
- 스킬 레지스트리 정리
- `/api/agent/skills`
- `/api/agent/plan`
- `/api/agent/proceed`
- 승인 후 산출물 저장

### Commit 3: backend: add meeting structure extraction API

포함 파일:

- `src/rag.ts`
- `src/index.ts`
- `README.md`

목적:

- PRD의 핵심인 결정사항/담당자/기한/미확정/요청 산출물 구조화를 API 계약으로 고정한다.

### Commit 4: backend: add hackathon demo seed data

포함 파일:

- `src/demo.ts`
- `src/index.ts`
- `README.md`

목적:

- 발표장에서 빈 워크스페이스라도 즉시 P0 플로우를 시연할 수 있게 한다.

### Commit 5: docs: describe backend MVP gaps and local runbook

포함 파일:

- `docs/backend-mvp-spec.md`
- `README.md`

목적:

- 팀원이 어떤 기능이 완료됐고 어떤 기능이 아직 남았는지 같은 기준으로 작업하게 한다.

### 별도 Frontend Commit 후보

이미 프론트에 변경된 파일이 있다면 백엔드 커밋과 분리하는 편이 좋다.

- `src/features/agent/rag.ts`
- `src/features/agent/AgentView.tsx`
- `src/index.css`

목적:

- plan/proceed UI, 스킬 표시, 산출물 생성 흐름 연결

## 8. 로컬 실행 방법

### 8.1 백엔드

```powershell
cd C:\Users\KKM\2026_LikeLion_Middle\ms_backend
npm install
Copy-Item .env.example .env
```

`.env`에 아래 값을 채운다.

```env
LIVEKIT_API_KEY=
LIVEKIT_API_SECRET=
OPENAI_API_KEY=
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
PORT=3001
```

Supabase SQL Editor에서 `supabase/p0-agent-schema.sql`을 실행한다.

서버 실행:

```powershell
npm run dev
```

헬스체크:

```powershell
Invoke-RestMethod http://localhost:3001/health
```

### 8.2 데모 플로우 테스트

`groupId`는 실제 Supabase `groups.id` 값을 사용한다.

```powershell
$groupId = "YOUR_GROUP_UUID"

Invoke-RestMethod `
  -Method Post `
  -Uri http://localhost:3001/api/demo/seed `
  -ContentType "application/json" `
  -Body (@{ groupId = $groupId } | ConvertTo-Json)

Invoke-RestMethod `
  -Method Post `
  -Uri "http://localhost:3001/api/rag/reindex?group=$groupId"
```

구조화 API:

```powershell
$seed = Invoke-RestMethod `
  -Method Post `
  -Uri http://localhost:3001/api/demo/seed `
  -ContentType "application/json" `
  -Body (@{ groupId = $groupId } | ConvertTo-Json)

Invoke-RestMethod `
  -Method Post `
  -Uri http://localhost:3001/api/meetings/structure `
  -ContentType "application/json" `
  -Body (@{
    groupId = $groupId
    direction = $seed.direction
    meetingTranscript = $seed.meetingTranscript
  } | ConvertTo-Json)
```

승인 후 PPT 초안 생성:

```powershell
$plan = Invoke-RestMethod `
  -Method Post `
  -Uri http://localhost:3001/api/agent/plan `
  -ContentType "application/json" `
  -Body (@{
    groupId = $groupId
    direction = $seed.direction
    meetingTranscript = $seed.meetingTranscript
  } | ConvertTo-Json)

Invoke-RestMethod `
  -Method Post `
  -Uri http://localhost:3001/api/agent/proceed `
  -ContentType "application/json" `
  -Body (@{
    groupId = $groupId
    approval = "proceed"
    mode = "ppt_draft"
    direction = $seed.direction
    meetingTranscript = $seed.meetingTranscript
    executionPlan = $plan.content
  } | ConvertTo-Json)
```

### 8.3 프론트 연결

```powershell
cd C:\Users\KKM\2026_LikeLion_Middle\ms_front
npm install
$env:VITE_API_BASE = "http://localhost:3001"
npm run dev -- --host 127.0.0.1 --port 5173
```

Vercel 배포에서는 `VITE_API_BASE`를 Render/AWS 백엔드 URL로 설정한다.

## 9. 해커톤 기준 우선순위

가장 먼저 보여줘야 하는 것은 "AI가 회의를 요약했다"가 아니라 "회의 결정이 회사 맥락을 거쳐 실행 가능한 일로 바뀌었다"는 장면이다.

발표 데모 순서:

1. 회사/제품/용어 문서 등록
2. 한영 회의 transcript 입력
3. 구조화 JSON에서 결정/담당자/기한 확인
4. 실행 계획 확인
5. `proceed` 승인
6. PPT 초안 또는 태스크 초안 생성
7. 생성 결과가 다시 지식 DB에 저장된 것 확인

이 흐름이 안정적으로 보이면, 실제 Notion/Jira/PPT/PDF 연동이 아직 없어도 P0 가치는 설명 가능하다. 다만 우승권을 노리려면 최소 하나는 실제 외부 산출물로 이어지는 모습을 추가하는 것이 좋다. 추천은 Notion/Jira보다 발표 시각 효과가 큰 `.pptx` 다운로드 기능이다.

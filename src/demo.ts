import { createClient, type SupabaseClient } from '@supabase/supabase-js'

let _db: SupabaseClient | null = null
function db(): SupabaseClient {
  if (_db) return _db
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set')
  _db = createClient(url, key, { auth: { persistSession: false } })
  return _db
}

const DEMO_TITLES = [
  '[Demo] 회사 프로파일 - NovaCloud',
  '[Demo] 제품 프로파일 - LaunchOps',
  '[Demo] 브랜드 톤과 업무 용어',
  '[Demo] 한영 제품 출시 회의 기록',
]

export const DEMO_DIRECTION =
  '한국 개발팀과 미국 고객이 합의한 제품 출시 회의 내용을 바탕으로 고객 공유용 Launch Plan PPT 초안과 실행 태스크를 만들어줘. 승인 전에는 실행 계획을 먼저 보여줘.'

export const DEMO_TRANSCRIPT = [
  '[PM / ko] 오늘 목표는 미국 고객 BetaCorp에 제공할 LaunchOps 1.2 출시 범위와 고객 공유 자료를 확정하는 것입니다.',
  '[Customer Success / en] BetaCorp needs a clear rollout plan by next Friday. They care most about onboarding, admin permissions, and migration risk.',
  '[Engineering Lead / ko] 이번 릴리즈에는 SSO, admin role audit log, CSV import 안정화까지 포함 가능합니다. 다만 Slack integration은 다음 스프린트로 미루는 게 안전합니다.',
  '[Customer / en] Please prepare a customer-facing launch deck. It should explain timeline, responsibilities, risks, and what BetaCorp needs to provide.',
  '[PM / ko] 결정하겠습니다. LaunchOps 1.2 범위는 SSO, admin audit log, CSV import 안정화로 확정하고 Slack integration은 P1로 넘깁니다.',
  '[PM / ko] 담당자는 민준이 기술 일정, Sarah가 고객 커뮤니케이션, 지윤이 PPT 초안을 맡습니다. 초안 기한은 8월 16일입니다.',
  '[Design / ko] PPT는 너무 기술적으로 가지 말고 고객 의사결정자가 이해할 수 있는 톤으로 하겠습니다.',
  '[Engineering Lead / ko] 리스크는 CSV import 대용량 파일 처리와 BetaCorp 샘플 데이터 수급입니다. 샘플 데이터는 고객이 8월 14일까지 전달해야 합니다.',
].join('\n')

function demoDocs(groupId: string) {
  return [
    {
      group_id: groupId,
      scope: 'group',
      title: DEMO_TITLES[0],
      content: [
        '회사명: NovaCloud',
        '산업: B2B SaaS / 클라우드 운영 자동화',
        '사업 모델: 팀 단위 구독형 SaaS',
        '주요 고객: 미국 중견 B2B 소프트웨어 기업, 글로벌 원격 협업팀',
        '브랜드 톤: 명확함, 신뢰감, 실행 중심, 과장 없는 전문성',
        '조직: PM, Engineering, Design, Customer Success가 제품 출시 프로젝트를 공동 운영',
        '중요 원칙: 고객 공유 자료는 기술 세부보다 일정, 책임, 리스크, 고객 액션을 먼저 보여준다.',
      ].join('\n'),
    },
    {
      group_id: groupId,
      scope: 'group',
      title: DEMO_TITLES[1],
      content: [
        '제품명: LaunchOps',
        '해결하는 문제: 글로벌 B2B SaaS 팀의 제품 출시 회의, 고객 온보딩, 릴리즈 책임 분담을 한 곳에서 실행 가능한 계획으로 바꾼다.',
        '타깃 고객: 한국 개발팀과 미국 고객/CS팀이 함께 일하는 B2B SaaS 조직',
        '핵심 가치: 회의 결정이 문서와 태스크로 바로 이어져 출시 지연과 재작업을 줄인다.',
        '현재 버전: 1.2 출시 준비',
        '이번 출시 핵심 범위: SSO, admin role audit log, CSV import 안정화',
        'P1 후보: Slack integration, advanced analytics, onboarding checklist 자동화',
      ].join('\n'),
    },
    {
      group_id: groupId,
      scope: 'group',
      title: DEMO_TITLES[2],
      content: [
        '용어집:',
        '- Launch Plan: 고객 공유용 출시 계획 자료',
        '- P0: 이번 MVP/릴리즈에서 반드시 포함할 범위',
        '- P1: 출시 이후 다음 스프린트에서 다룰 범위',
        '- Owner: 해당 업무의 최종 책임자',
        '- Evidence: 회의 중 해당 결정을 뒷받침하는 발언',
        '문서 작성 원칙:',
        '- 고객용 문서는 timeline, responsibility, risk, customer action 순서로 작성한다.',
        '- 내부용 문서는 decision, owner, due date, dependency, blocker를 표로 정리한다.',
      ].join('\n'),
    },
    {
      group_id: groupId,
      scope: 'meeting',
      title: DEMO_TITLES[3],
      content: DEMO_TRANSCRIPT,
    },
  ]
}

export async function seedDemoWorkspace(groupId: string): Promise<{
  docs: number
  titles: string[]
  direction: string
  meetingTranscript: string
}> {
  await db().from('docs').delete().eq('group_id', groupId).in('title', DEMO_TITLES)

  const rows = demoDocs(groupId)
  const { error } = await db().from('docs').insert(rows)
  if (error) throw new Error(error.message)

  return {
    docs: rows.length,
    titles: rows.map((row) => row.title),
    direction: DEMO_DIRECTION,
    meetingTranscript: DEMO_TRANSCRIPT,
  }
}

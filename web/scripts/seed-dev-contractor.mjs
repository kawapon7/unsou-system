import { readFileSync } from 'fs'
import { resolve } from 'path'
import { createClient } from '@supabase/supabase-js'

const envPath = resolve('/Users/kawasakiatsushi/developer/unsou-system/web', '.env.local')
const env = Object.fromEntries(
  readFileSync(envPath, 'utf8').split('\n')
    .filter(l => l && !l.startsWith('#') && l.includes('='))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1)] }),
)

const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const TENANT_ID = 'local-dev'
const DEV_ID = 'cc31ee16-660a-42db-acb4-05f148a3fce8'

const { data: c } = await db.from('contractors').select('id,name').eq('id', DEV_ID).eq('tenant_id', TENANT_ID).maybeSingle()
if (!c) {
  console.log('❌ DEV_CONTRACTOR_ID が存在しません')
  const { data: all } = await db.from('contractors').select('id,name,email').eq('tenant_id', TENANT_ID).limit(5)
  console.log('存在するcontractors:', JSON.stringify(all, null, 2))
  process.exit(1)
}
console.log('contractor:', c.name)

const { data: payees } = await db.from('project_payees').select('project_id').eq('payee_contractor_id', DEV_ID).eq('tenant_id', TENANT_ID).limit(1)

let projectId
if (!payees?.length) {
  const { data: projs } = await db.from('projects').select('id,name').eq('tenant_id', TENANT_ID).limit(1)
  if (!projs?.length) { console.log('❌ プロジェクトなし'); process.exit(1) }
  projectId = projs[0].id
  await db.from('project_payees').insert({ project_id: projectId, payee_contractor_id: DEV_ID, tenant_id: TENANT_ID, unit_type: 'fixed', unit_price: 15000 })
  console.log('project_payee 追加:', projs[0].name)
} else {
  projectId = payees[0].project_id
  console.log('既存 project_id:', projectId)
}

const dates = ['2026-06-17','2026-06-18','2026-06-19','2026-06-20','2026-06-23','2026-06-24']
const { data: existing } = await db.from('schedules').select('scheduled_date').eq('contractor_id', DEV_ID).eq('tenant_id', TENANT_ID).in('scheduled_date', dates)
const existingSet = new Set((existing ?? []).map(s => s.scheduled_date))
const toInsert = dates.filter(d => !existingSet.has(d)).map(d => ({ contractor_id: DEV_ID, project_id: projectId, scheduled_date: d, tenant_id: TENANT_ID }))

if (!toInsert.length) { console.log('✅ 既にデータあり'); process.exit(0) }
const { error } = await db.from('schedules').insert(toInsert)
if (error) { console.error('insert error:', error.message); process.exit(1) }
console.log('✅ schedules 挿入:', toInsert.map(s => s.scheduled_date).join(', '))

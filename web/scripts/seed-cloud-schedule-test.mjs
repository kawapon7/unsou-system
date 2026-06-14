import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { createClient } from '@supabase/supabase-js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const envPath = resolve(__dirname, '../.env.local')
const env = Object.fromEntries(
  readFileSync(envPath, 'utf8')
    .split('\n')
    .filter(line => line && !line.startsWith('#') && line.includes('='))
    .map(line => {
      const i = line.indexOf('=')
      return [line.slice(0, i), line.slice(i + 1)]
    }),
)

const url = env.NEXT_PUBLIC_SUPABASE_URL
const key = env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local')
  process.exit(1)
}

const db = createClient(url, key, { auth: { persistSession: false } })
const TENANT_ID = 'local-dev'
const SCHEDULE_DATE = '2026-06-14'
const DRIVER_NAME = '山田 次郎'
const DRIVER_EMAIL = 'driver@hibiki.com'
const PROJECT_CODE = 'PROJ-001'

async function findOrCreateClient() {
  const { data: existing } = await db
    .from('clients')
    .select('id')
    .eq('company_name', 'テスト物流株式会社')
    .eq('tenant_id', TENANT_ID)
    .maybeSingle()

  if (existing?.id) return existing.id

  const { data, error } = await db
    .from('clients')
    .insert({
      company_name: 'テスト物流株式会社',
      contact_name: '田中 太郎',
      email: 'tanaka@test.co.jp',
      phone: '03-1234-5678',
      tax_type: 'exclusive',
      closing_day: '31',
      payment_site: 30,
      invoice_registered: false,
      tenant_id: TENANT_ID,
    })
    .select('id')
    .single()

  if (error) throw new Error(`clients insert: ${error.message}`)
  return data.id
}

async function findOrCreateContractor() {
  const { data: existing } = await db
    .from('contractors')
    .select('id')
    .eq('name', DRIVER_NAME)
    .eq('tenant_id', TENANT_ID)
    .maybeSingle()

  if (existing?.id) return existing.id

  const { data, error } = await db
    .from('contractors')
    .insert({
      name: DRIVER_NAME,
      email: DRIVER_EMAIL,
      phone: '090-9876-5432',
      contractor_type: 'individual',
      invoice_registration_type: 'unregistered',
      tax_category: 'exempt',
      payment_type: 'bank_transfer',
      payment_site: 20,
      tenant_id: TENANT_ID,
    })
    .select('id')
    .single()

  if (error) throw new Error(`contractors insert: ${error.message}`)
  return data.id
}

async function findOrCreateProject(clientId, contractorId) {
  const { data: existing } = await db
    .from('projects')
    .select('id')
    .eq('project_code', PROJECT_CODE)
    .eq('tenant_id', TENANT_ID)
    .maybeSingle()

  if (existing?.id) return existing.id

  const { data, error } = await db
    .from('projects')
    .insert({
      project_code: PROJECT_CODE,
      project_name: '城南エリア宅配便（テスト）',
      client_id: clientId,
      contractor_id: contractorId,
      status: 'active',
      unit_type: 'count',
      sale_amount: 0,
      tenant_id: TENANT_ID,
    })
    .select('id')
    .single()

  if (error) throw new Error(`projects insert: ${error.message}`)
  return data.id
}

async function upsertSchedule(contractorId, projectId) {
  const { data: existing } = await db
    .from('schedules')
    .select('id, status, date')
    .eq('contractor_id', contractorId)
    .eq('date', SCHEDULE_DATE)
    .maybeSingle()

  if (existing?.id) {
    if (existing.status !== 'scheduled') {
      const { error } = await db
        .from('schedules')
        .update({ status: 'scheduled' })
        .eq('id', existing.id)
      if (error) throw new Error(`schedules update: ${error.message}`)
    }
    return existing.id
  }

  const { data, error } = await db
    .from('schedules')
    .insert({
      contractor_id: contractorId,
      project_id: projectId,
      date: SCHEDULE_DATE,
      status: 'scheduled',
      tenant_id: TENANT_ID,
    })
    .select('id')
    .single()

  if (error) throw new Error(`schedules insert: ${error.message}`)
  return data.id
}

async function main() {
  console.log('Target:', url)

  const clientId = await findOrCreateClient()
  console.log('client_id:', clientId)

  const contractorId = await findOrCreateContractor()
  console.log('contractor_id:', contractorId)

  const projectId = await findOrCreateProject(clientId, contractorId)
  console.log('project_id:', projectId)

  const scheduleId = await upsertSchedule(contractorId, projectId)
  console.log('schedule_id:', scheduleId)

  const { count, error: wrErr } = await db
    .from('work_records')
    .select('id', { count: 'exact', head: true })
    .eq('contractor_id', contractorId)
    .eq('work_date', SCHEDULE_DATE)

  if (wrErr) console.warn('work_records check:', wrErr.message)
  else console.log('work_records on', SCHEDULE_DATE + ':', count ?? 0)

  const { data: verify, error: vErr } = await db
    .from('schedules')
    .select('id, contractor_id, project_id, date, status, tenant_id')
    .eq('id', scheduleId)
    .single()

  if (vErr) throw new Error(`verify: ${vErr.message}`)
  console.log('verified:', verify)
  console.log('\nCloud seed complete.')
}

main().catch(err => {
  console.error(err.message ?? err)
  process.exit(1)
})

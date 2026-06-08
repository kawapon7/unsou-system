import crypto from 'crypto'

const SUPABASE_URL = 'https://hbpnhbsmsuhjyrohpluu.supabase.co'
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhicG5oYnNtc3Voanlyb2hwbHV1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA2ODg2OTEsImV4cCI6MjA5NjI2NDY5MX0.p1WyMnvm-CsFq15VOCNcXePl6SeASUrcxZFb67EOl68'
const ENCRYPTION_KEY = 'af06d46182cc96d25feffd96806176f6'

function encryptText(text) {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(ENCRYPTION_KEY), iv)
  let encrypted = cipher.update(text, 'utf8', 'hex')
  encrypted += cipher.final('hex')
  const authTag = cipher.getAuthTag().toString('hex')
  return `${iv.toString('hex')}:${authTag}:${encrypted}`
}

async function rest(path, method, token, body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: ANON_KEY,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = await res.json()
  if (!res.ok) throw new Error(`${path} ${method} failed: ${JSON.stringify(data)}`)
  return data
}

// ログイン
const loginRes = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
  method: 'POST',
  headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'admin@hibiki.com', password: 'password123' }),
})
const loginData = await loginRes.json()
if (!loginData.access_token) throw new Error('ログイン失敗: ' + JSON.stringify(loginData))
const token = loginData.access_token
const adminUserId = loginData.user.id
console.log('✓ ログイン成功 userId:', adminUserId)

// 1. 荷主マスタ (clients)
const [client] = await rest('clients', 'POST', token, {
  company_name: 'テスト物流株式会社',
  contact_name: '田中 太郎',
  email: 'tanaka@test-logistics.co.jp',
  phone: '03-1234-5678',
  tax_type: 'taxable_10',
  invoice_registered: true,
  closing_day: '末日',
  payment_site: 30,
  bank_name: encryptText('テスト銀行'),
  bank_branch: encryptText('渋谷支店'),
  account_type: encryptText('普通'),
  account_number: encryptText('1234567'),
  account_holder: encryptText('テストブツリュウカブシキガイシャ'),
})
console.log('✓ clients 挿入完了 id:', client.id)

// 2. 委託先マスタ (contractors) - 子分ドライバー
const [contractor] = await rest('contractors', 'POST', token, {
  name: '山田 次郎',
  login_email: 'driver@hibiki.com',
  email: 'driver@hibiki.com',
  phone: '090-9876-5432',
  contractor_type: 'individual',
  tax_type: 'exempt',
  invoice_registration_type: 'unregistered',
  payment_method: 'bank_transfer',
  payment_site: 20,
  withholding_tax_flag: true,
  detailed_input_switch: false,
  bank_name: encryptText('テスト銀行'),
  bank_branch: encryptText('新宿支店'),
  account_type: encryptText('普通'),
  account_number: encryptText('7654321'),
  account_holder: encryptText('ヤマダジロウ'),
})
console.log('✓ contractors 挿入完了 id:', contractor.id)

// 3. 案件マスタ (projects)
const [project] = await rest('projects', 'POST', token, {
  project_code: 'PROJ-001',
  project_name: '城南エリア宅配便（テスト）',
  client_id: client.id,
  contractor_id: contractor.id,
  status: 'active',
  unit_type: 'count',
  sale_amount: 2500,
  buy_amount: 2000,
  origin: '東京都品川区',
  destination: '東京都大田区',
  operation_start: '2026-06-01',
})
console.log('✓ projects 挿入完了 id:', project.id)

// 4. 単価ルール (price_rules)
await rest('price_rules', 'POST', token, {
  project_id: project.id,
  calc_type: 'count',
  sale_unit_price: 2500,
  buy_unit_price: 2000,
  effective_from: '2026-06-01',
})
console.log('✓ price_rules 挿入完了')

// 5. users テーブルに admin レコード登録
try {
  await rest('users', 'POST', token, {
    id: adminUserId,
    email: 'admin@hibiki.com',
    role: 'owner',
  })
  console.log('✓ users (admin) 挿入完了')
} catch (e) {
  console.log('⚠ users (admin) 既存またはRLS制限:', e.message)
}

console.log('\n=== シード完了 ===')
console.log('荷主:', client.company_name, '(id:', client.id + ')')
console.log('委託先:', contractor.name, '(id:', contractor.id + ')')
console.log('案件:', project.project_name, '(id:', project.id + ')')

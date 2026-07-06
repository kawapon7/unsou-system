/**
 * 口座情報バックフィル暗号化スクリプト
 *
 * ⚠️ SUPABASE_SERVICE_ROLE_KEY を使用するため取り扱い注意。RLSを完全バイパスする。
 * ⚠️ 本番の clients/contractors テーブルの bank_name/bank_branch/account_number/account_holder を
 *    直接書き換える。実行前に --dry-run で対象件数を確認すること。
 *
 * 暗号化フォーマットは web/src/utils/crypto.ts の encryptText と完全に一致させること
 * （AES-256-GCM, ランダムIV 12バイト, `iv:tag:cipher` のhex文字列）。
 *
 * 使い方:
 *   NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co \
 *   SUPABASE_SERVICE_ROLE_KEY=eyJ... \
 *   ENCRYPTION_KEY=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx \
 *   node web/scripts/backfill-encrypt-bank-fields.mjs --dry-run
 *
 *   確認後、--dry-run を外して実行すると実際にUPDATEされる。
 */

import { createClient } from '@supabase/supabase-js'
import crypto from 'crypto'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const encryptionKey = process.env.ENCRYPTION_KEY
const dryRun = process.argv.includes('--dry-run')

if (!url || !serviceKey) throw new Error('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY が未設定です')
if (!encryptionKey || encryptionKey.length !== 32) throw new Error('ENCRYPTION_KEY は32バイトで設定してください')

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 12
const ENCRYPTED_FORMAT = /^[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/i
const BANK_FIELDS = ['bank_name', 'bank_branch', 'account_number', 'account_holder']

function encryptText(text) {
  const iv = crypto.randomBytes(IV_LENGTH)
  const cipher = crypto.createCipheriv(ALGORITHM, Buffer.from(encryptionKey), iv)
  let encrypted = cipher.update(text, 'utf8', 'hex')
  encrypted += cipher.final('hex')
  const authTag = cipher.getAuthTag().toString('hex')
  return `${iv.toString('hex')}:${authTag}:${encrypted}`
}

function isEncryptedValue(value) {
  return ENCRYPTED_FORMAT.test(value)
}

const supabase = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })

async function fetchAllRows(table) {
  const pageSize = 1000
  const allRows = []
  let from = 0
  while (true) {
    const { data, error } = await supabase
      .from(table)
      .select(`id, ${BANK_FIELDS.join(', ')}`)
      .range(from, from + pageSize - 1)
    if (error) throw error
    if (!data || data.length === 0) break
    allRows.push(...data)
    if (data.length < pageSize) break
    from += pageSize
  }
  return allRows
}

async function backfillTable(table) {
  const rows = await fetchAllRows(table)

  let targetCount = 0
  let updatedCount = 0

  for (const row of rows ?? []) {
    const patch = {}
    for (const field of BANK_FIELDS) {
      const value = row[field]
      if (typeof value === 'string' && value.length > 0 && !isEncryptedValue(value)) {
        patch[field] = encryptText(value)
      }
    }
    if (Object.keys(patch).length === 0) continue
    targetCount += 1

    if (dryRun) {
      console.log(`[dry-run] ${table} id=${row.id}: ${Object.keys(patch).join(', ')} を暗号化予定`)
      continue
    }

    const { error: updateErr } = await supabase.from(table).update(patch).eq('id', row.id)
    if (updateErr) {
      console.error(`更新失敗 ${table} id=${row.id}:`, updateErr.message)
      continue
    }
    updatedCount += 1
  }

  console.log(`${table}: 対象 ${targetCount} 件中 ${dryRun ? 0 : updatedCount} 件を更新しました（dry-run=${dryRun}）`)
}

await backfillTable('clients')
await backfillTable('contractors')

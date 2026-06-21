'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/utils/supabase/server'
import { createServiceClient } from '@/utils/supabase/service'
import { getCurrentTenantId } from '@/utils/tenant'
import {
  parseGoogleFormCsv,
  matchMasterData,
  type MasterRecord,
  type MatchedWorkRecord,
} from '@/utils/scan/fileConverter'
import {
  createWorkRecord,
  type CreateWorkRecordPayload,
} from '@/app/_actions/workRecordActions'

type ActionResult<T = void> =
  | { data: T; error: null }
  | { data: null; error: string }

const OWNER_ROLES = new Set(['master', 'owner'])

async function requireOwner(): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient()
  const { data: { user }, error: authErr } = await supabase.auth.getUser()
  if (authErr || !user) return { ok: false, error: '未ログインです' }

  const { data: userData } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .maybeSingle()

  const role = userData?.role ?? (user.user_metadata?.role as string | undefined)
  if (!role || !OWNER_ROLES.has(role)) return { ok: false, error: '管理者権限が必要です' }

  return { ok: true }
}

// ── スプレッドシートURLをCSVエクスポートURLに変換 ──────────────

function toExportUrl(url: string): string {
  const m = url.match(/\/spreadsheets\/d\/([^/?#]+)/)
  if (!m) return url
  const sheetId = m[1]
  const gidMatch = url.match(/[#&?]gid=(\d+)/)
  const gid = gidMatch ? `&gid=${gidMatch[1]}` : ''
  return `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv${gid}`
}

// ── previewEmergencyRecords ────────────────────────────────────

export type PreviewEmergencyResult = {
  records:     MatchedWorkRecord[]
  contractors: MasterRecord[]
  projects:    MasterRecord[]
  parseErrors: string[]
}

/**
 * CSVテキストまたはGoogleスプレッドシートURLをパースし、マスタ照合結果を返す。
 * DB書き込みは行わない（プレビュー専用）。
 */
export async function previewEmergencyRecords(
  fileData: string,
  fileType: 'csv' | 'url',
): Promise<ActionResult<PreviewEmergencyResult>> {
  const auth = await requireOwner()
  if (!auth.ok) return { data: null, error: auth.error }

  const tenantId = await getCurrentTenantId()
  const db = createServiceClient() as any

  const [contractorsRes, projectsRes] = await Promise.all([
    db.from('contractors').select('id, name').eq('tenant_id', tenantId),
    db.from('projects').select('id, project_name, name').eq('tenant_id', tenantId),
  ])

  if (contractorsRes.error) return { data: null, error: contractorsRes.error.message }
  if (projectsRes.error)    return { data: null, error: projectsRes.error.message }

  const contractors: MasterRecord[] = (contractorsRes.data ?? []).map((c: any) => ({
    id:   c.id,
    name: c.name,
  }))
  const projects: MasterRecord[] = (projectsRes.data ?? []).map((p: any) => ({
    id:   p.id,
    name: p.project_name ?? p.name ?? p.id,
  }))

  let csvText = fileData
  if (fileType === 'url') {
    const exportUrl = toExportUrl(fileData.trim())
    try {
      const res = await fetch(exportUrl)
      if (!res.ok) {
        return {
          data: null,
          error: `スプレッドシートの取得に失敗しました（HTTP ${res.status}）。`
            + 'シートが「リンクを知っている全員」に公開されているか確認してください。',
        }
      }
      csvText = await res.text()
    } catch (e) {
      return {
        data: null,
        error: `スプレッドシートの取得中にエラーが発生しました: ${e instanceof Error ? e.message : String(e)}`,
      }
    }
  }

  const parseResult = parseGoogleFormCsv(csvText)
  const matched     = matchMasterData(parseResult.records, contractors, projects)
  const parseErrors = [...parseResult.parseErrors, ...matched.matchErrors]

  return {
    data: { records: matched.records, contractors, projects, parseErrors },
    error: null,
  }
}

// ── importCorrectedRecords ─────────────────────────────────────

export type CorrectedRecord = {
  contractorId: string
  projectId:    string
  date:         string
  quantity:     number
  sourceRow:    number | null
}

export type ImportCorrectedResult = {
  imported: number
  skipped:  number
  errors:   string[]
}

/**
 * プレビュー画面で手動補正済みのレコードを一括登録する。
 * 登録前に管理者権限を再確認する。
 */
export async function importCorrectedRecords(
  records: CorrectedRecord[],
): Promise<ActionResult<ImportCorrectedResult>> {
  const auth = await requireOwner()
  if (!auth.ok) return { data: null, error: auth.error }

  let imported = 0
  let skipped  = 0
  const errors: string[] = []

  for (const rec of records) {
    const payload: CreateWorkRecordPayload = {
      contractor_id: rec.contractorId,
      project_id:    rec.projectId,
      date:          rec.date,
      quantity:      rec.quantity,
    }
    const result = await createWorkRecord(payload)
    if (result.error) {
      errors.push(`行 ${rec.sourceRow ?? '?'}: ${result.error}`)
      skipped++
    } else {
      imported++
    }
  }

  revalidatePath('/admin/dashboard')
  revalidatePath('/admin/sales')

  return { data: { imported, skipped, errors }, error: null }
}

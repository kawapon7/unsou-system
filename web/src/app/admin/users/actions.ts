'use server'

import { createClient } from '@/utils/supabase/server'
import { createServiceClient } from '@/utils/supabase/service'
import { getCurrentTenantId } from '@/utils/tenant'

export type UserRole = 'master' | 'driver'

export type ManagedUser = {
  id: string
  email: string
  role: UserRole
  contractor_id: string | null
  contractor_name: string | null
  created_at: string
}

type ActionResult<T = void> =
  | { data: T; error: null }
  | { data: null; error: string }

export async function listUsers(): Promise<ActionResult<ManagedUser[]>> {
  const db = createServiceClient()

  const { data: { users: authUsers }, error: authErr } = await db.auth.admin.listUsers({ perPage: 200 })
  if (authErr) return { data: null, error: authErr.message }

  const { data: pubUsers, error: pubErr } = await db
    .from('users')
    .select('id, email, role')
  if (pubErr) return { data: null, error: pubErr.message }

  const pubMap = Object.fromEntries(
    (pubUsers ?? []).map((u: { id: string; role: string }) => [u.id, u])
  )

  // メールアドレスで contractors と照合
  const emails = authUsers.map(u => u.email).filter(Boolean) as string[]
  const { data: contractors } = await db
    .from('contractors')
    .select('id, name, email')
    .in('email', emails)

  const contractorByEmail = Object.fromEntries(
    (contractors ?? []).map((c: { id: string; name: string; email: string }) => [c.email, c])
  )

  const result: ManagedUser[] = authUsers
    .filter(u => u.email)
    .map(u => {
      const pub = pubMap[u.id] as { role: string } | undefined
      const rawRole = pub?.role ?? u.user_metadata?.role ?? 'sub'
      const role: UserRole = rawRole === 'master' ? 'master' : 'driver'
      const contractor = contractorByEmail[u.email!] ?? null
      return {
        id: u.id,
        email: u.email!,
        role,
        contractor_id: contractor?.id ?? null,
        contractor_name: contractor?.name ?? null,
        created_at: u.created_at,
      }
    })
    .sort((a, b) => {
      if (a.role !== b.role) return a.role === 'master' ? -1 : 1
      return a.email.localeCompare(b.email)
    })

  return { data: result, error: null }
}

export async function createAdminUser(
  email: string,
  password: string,
  currentPassword: string
): Promise<ActionResult> {
  const db = createServiceClient()

  // 現在の管理者パスワードを再検証（通常クライアントで signInWithPassword）
  const regularDb = await createClient()
  const { data: { user: currentUser } } = await regularDb.auth.getUser()
  if (!currentUser?.email) return { data: null, error: '認証情報を取得できません' }

  const { error: verifyErr } = await regularDb.auth.signInWithPassword({
    email: currentUser.email,
    password: currentPassword,
  })
  if (verifyErr) return { data: null, error: 'パスワードが正しくありません' }

  const { data: authData, error: authErr } = await db.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  })
  if (authErr) return { data: null, error: authErr.message }

  const { error: pubErr } = await db.from('users').insert({
    id: authData.user.id,
    email,
    role: 'master',
  })
  if (pubErr) {
    await db.auth.admin.deleteUser(authData.user.id)
    return { data: null, error: pubErr.message }
  }

  return { data: undefined, error: null }
}

export async function createDriverUser(
  email: string,
  password: string,
  contractorId: string
): Promise<ActionResult> {
  const db = createServiceClient()
  const tenantId = await getCurrentTenantId()

  // 委託先の存在確認
  const { data: contractor, error: cErr } = await db
    .from('contractors')
    .select('id, name, email')
    .eq('id', contractorId)
    .eq('tenant_id', tenantId)
    .maybeSingle()
  if (cErr || !contractor) return { data: null, error: '委託先が見つかりません' }

  // auth ユーザー作成
  const { data: authData, error: authErr } = await db.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  })
  if (authErr) return { data: null, error: authErr.message }

  // public.users に登録
  const { error: pubErr } = await db.from('users').insert({
    id: authData.user.id,
    email,
    role: 'sub',
  })
  if (pubErr) {
    await db.auth.admin.deleteUser(authData.user.id)
    return { data: null, error: pubErr.message }
  }

  // contractors.email を更新（メールアドレスでcontractor紐づけ）
  const { error: updateErr } = await db
    .from('contractors')
    .update({ email })
    .eq('id', contractorId)
    .eq('tenant_id', tenantId)
  if (updateErr) {
    await db.auth.admin.deleteUser(authData.user.id)
    await db.from('users').delete().eq('id', authData.user.id)
    return { data: null, error: updateErr.message }
  }

  return { data: undefined, error: null }
}

export async function updateUser(
  userId: string,
  opts: {
    role?: UserRole
    password?: string
    contractorId?: string | null
  }
): Promise<ActionResult> {
  const db = createServiceClient()
  const tenantId = await getCurrentTenantId()

  // auth側：パスワード変更
  if (opts.password) {
    const { error } = await db.auth.admin.updateUserById(userId, { password: opts.password })
    if (error) return { data: null, error: error.message }
  }

  // public.users：ロール変更
  if (opts.role !== undefined) {
    const dbRole = opts.role === 'master' ? 'master' : 'sub'
    const { error } = await db.from('users').upsert({ id: userId, role: dbRole }, { onConflict: 'id' })
    if (error) return { data: null, error: error.message }
  }

  // 委託先の紐づけ変更（ドライバーのみ）
  if (opts.contractorId !== undefined) {
    // まず現在のauth userのemailを取得
    const { data: authUser } = await db.auth.admin.getUserById(userId)
    const email = authUser?.user?.email
    if (!email) return { data: null, error: 'メールアドレスを取得できません' }

    if (opts.contractorId) {
      // 新しい委託先のemailを更新
      const { error } = await db
        .from('contractors')
        .update({ email })
        .eq('id', opts.contractorId)
        .eq('tenant_id', tenantId)
      if (error) return { data: null, error: error.message }
    }
  }

  return { data: undefined, error: null }
}

export async function deleteUser(userId: string): Promise<ActionResult> {
  const db = createServiceClient()

  await db.from('users').delete().eq('id', userId)

  const { error } = await db.auth.admin.deleteUser(userId)
  if (error) return { data: null, error: error.message }

  return { data: undefined, error: null }
}

export async function listContractors(): Promise<ActionResult<{ id: string; name: string; email: string; hasAccount: boolean }[]>> {
  const db = createServiceClient()
  const tenantId = await getCurrentTenantId()

  const { data, error } = await db
    .from('contractors')
    .select('id, name, email')
    .eq('tenant_id', tenantId)
    .order('name')
  if (error) return { data: null, error: error.message }

  // Auth ユーザーのメール一覧を取得してアカウント済みか判定
  const { data: { users: authUsers } } = await db.auth.admin.listUsers({ perPage: 200 })
  const accountEmails = new Set(authUsers.map(u => u.email).filter(Boolean))

  return {
    data: (data ?? []).map((c: { id: string; name: string; email: string }) => ({
      id: c.id,
      name: c.name,
      email: c.email,
      hasAccount: accountEmails.has(c.email),
    })),
    error: null,
  }
}

export type ProjectOption = {
  id:           string
  project_name: string
  project_code: string | null
  client_id:    string | null
  client_name:  string | null
}

export async function listProjects(): Promise<ActionResult<ProjectOption[]>> {
  const db = createServiceClient()
  const tenantId = await getCurrentTenantId()

  const { data, error } = await db
    .from('projects')
    .select('id, project_name, project_code, client_id, clients(company_name)')
    .eq('tenant_id', tenantId)
    .neq('status', 'cancelled')
    .order('project_name')
  if (error) return { data: null, error: error.message }

  return {
    data: (data ?? []).map((p: any) => ({
      id:           p.id,
      project_name: p.project_name,
      project_code: p.project_code ?? null,
      client_id:    p.client_id ?? null,
      client_name:  p.clients?.company_name ?? null,
    })),
    error: null,
  }
}

export async function fetchDriverAssignments(contractorId: string): Promise<ActionResult<string[]>> {
  const db = createServiceClient()

  const { data, error } = await db
    .from('driver_project_assignments')
    .select('project_id')
    .eq('contractor_id', contractorId)
  if (error) return { data: null, error: error.message }
  return { data: (data ?? []).map((r: { project_id: string }) => r.project_id), error: null }
}

export async function updateDriverAssignments(
  contractorId: string,
  projectIds: string[]
): Promise<ActionResult> {
  const db = createServiceClient()
  const tenantId = await getCurrentTenantId()

  const { error: delErr } = await db
    .from('driver_project_assignments')
    .delete()
    .eq('contractor_id', contractorId)
  if (delErr) return { data: null, error: delErr.message }

  if (projectIds.length > 0) {
    const rows = projectIds.map(pid => ({
      contractor_id: contractorId,
      project_id: pid,
      tenant_id: tenantId,
    }))
    const { error: insErr } = await db.from('driver_project_assignments').insert(rows)
    if (insErr) return { data: null, error: insErr.message }
  }

  return { data: undefined, error: null }
}

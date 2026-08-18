/**
 * ドライバー向けアプリ内お知らせの文面生成（純関数）。
 *
 * ⚠️ notification_logs は「メールを送った記録」であり、本文の列を持たない
 *    （type / destination / status / alert_key のみ）。したがって文面はここで組み立てる。
 *    親分からの自由入力の連絡は、本文を持つ別テーブルが無いため現時点では扱えない。
 * ⚠️ 送信 status が failed の記録も対象にすること。むしろ**メールが届かなかった分こそ**
 *    アプリで見せる意味がある（実測: missing_input の18件は全件 failed だった）。
 */

export type AlertRef = { kind: string; targetId: string }

/** 'missing_input:<uuid>' を種別と対象IDに分ける */
export function parseAlertKey(alertKey: string | null | undefined): AlertRef {
  if (!alertKey) return { kind: '', targetId: '' }
  const i = alertKey.indexOf(':')
  if (i < 0) return { kind: alertKey, targetId: '' }
  return { kind: alertKey.slice(0, i), targetId: alertKey.slice(i + 1) }
}

/**
 * ドライバーに見せてよい種別か。
 * ⚠️ 未知の種別は見せない（fail-closed）。荷主の入金遅延など、親分向けの情報を
 *    委託先に流すと事故になる。
 */
export function isDriverFacing(kind: string): boolean {
  return kind === 'missing_input' || kind === 'pending_notice'
}

export type DriverNotice = {
  title: string
  body:  string
  /** タップしたときの遷移先 */
  href:  string
}

export type NoticeDetail = {
  /** missing_input 用: 'YYYY-MM-DD' */
  date?:        string
  projectName?: string
  /** pending_notice 用: 'YYYY-MM-DD'（月初日） */
  noticeMonth?: string
}

const mdOf = (iso: string) => {
  const [, m, d] = iso.split('-').map(Number)
  return `${m}/${d}`
}

/**
 * 種別と（引けたなら）対象の詳細から文面を作る。
 * ⚠️ 詳細が取れなくても必ず文面を返す。空のお知らせを出すと、ドライバーには
 *    「何か起きたが内容は分からない」という一番不安な表示になる。
 */
export function buildDriverNotice(kind: string, detail: NoticeDetail): DriverNotice {
  if (kind === 'pending_notice') {
    const m = detail.noticeMonth
    const label = m ? `${Number(m.slice(0, 4))}年${Number(m.slice(5, 7))}月分の` : ''
    return {
      title: '支払通知書の確認をお願いします',
      body:  `${label}支払通知書が未承認です。金額をご確認ください。`,
      href:  '/driver/billing',
    }
  }

  // missing_input（既定）
  const title = '稼働実績が未入力です'
  if (!detail.date) {
    return { title, body: '稼働実績が未入力の日があります。予定・実績からご確認ください。', href: '/driver/schedule' }
  }
  const where = detail.projectName ? `${mdOf(detail.date)}（${detail.projectName}）の` : `${mdOf(detail.date)} の`
  return {
    title,
    body: `${where}実績がまだ入力されていません。予定・実績から入力してください。`,
    href: '/driver/schedule',
  }
}

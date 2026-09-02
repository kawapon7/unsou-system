/**
 * error_logs 保存前のマスキング。spec §4。
 * 口座情報・個人情報・トークンが平文で残らないようにする。順序は重要:
 * 行データ除去 → トークン → メール → 数字列（数字列を先にやるとメール/トークン判定が崩れる）。
 */
export const MESSAGE_MAX = 2000
export const STACK_MAX   = 4000

const FAILING_ROW = /DETAIL:\s*Failing row contains \([^)]*\)\.?/g
const JWT         = /\beyJ[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+){1,2}\b/g
const API_KEY     = /\b(?:re_|sk_|AIza)[A-Za-z0-9_-]+\b/g
const EMAIL       = /[A-Za-z0-9._%+-]+@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g
const DIGITS      = /\d(?:[\d-]*\d)?/g

export function mask(text: string, maxLen: number): string {
  let out = text
    .replace(FAILING_ROW, 'DETAIL: [row omitted]')
    .replace(JWT, '[token]')
    .replace(API_KEY, '[token]')
    .replace(EMAIL, '***@$1')
    .replace(DIGITS, (m) => (m.replace(/-/g, '').length >= 6 ? '[digits]' : m))
  if (out.length > maxLen) out = out.slice(0, maxLen)
  return out
}

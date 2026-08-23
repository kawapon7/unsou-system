// 発行控え（issued_documents）の検索条件と一覧用の型。
// ⚠️ 'use server' ファイル（document-actions.ts）は型以外を export できないため、型はここに置く。
import type { DocumentKind } from './document-formats'

export type IssuedDocumentFilter = {
  kind?: DocumentKind | ''
  dateFrom?: string
  dateTo?: string
  party?: string
  minAmount?: string
  maxAmount?: string
  includeCancelled?: boolean
}

export type IssuedDocumentSummary = {
  id: string
  kind: DocumentKind
  sourceId: string
  documentNumber: string
  formatKey: string
  formatVersion: number
  status: 'issued' | 'cancelled'
  issuedAt: string
  cancelledAt: string | null
  cancelReason: string | null
  supersededBy: string | null
  partyName: string
  documentDate: string
  totalAmount: number
}

export type IssuedDocumentDetail = IssuedDocumentSummary & { snapshot: unknown }

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function toAmount(s?: string): number | null {
  if (!s) return null
  const n = Number(s.replace(/[,\s]/g, ''))
  return Number.isFinite(n) ? n : null
}

function toDate(s?: string): string | null {
  return s && DATE_RE.test(s) ? s : null
}

export function normalizeFilter(f: IssuedDocumentFilter) {
  const party = f.party?.trim() ?? ''
  return {
    kind: f.kind === 'invoice' || f.kind === 'payment_notice' ? f.kind : null,
    dateFrom: toDate(f.dateFrom),
    dateTo: toDate(f.dateTo),
    party: party ? party : null,
    minAmount: toAmount(f.minAmount),
    maxAmount: toAmount(f.maxAmount),
    includeCancelled: !!f.includeCancelled,
  }
}

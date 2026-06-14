import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
} from '@react-pdf/renderer'
import type { PaymentNoticePdfTemplateData } from '@/app/_actions/pdfActions'
import { ensurePdfFonts } from '@/utils/pdf/registerFonts'

ensurePdfFonts()

const COMPANY = {
  name:  process.env.NEXT_PUBLIC_COMPANY_NAME  ?? '○○運送有限会社',
  phone: process.env.NEXT_PUBLIC_COMPANY_PHONE ?? '000-0000-0000',
}

const EXPENSE_TYPE_LABEL: Record<string, string> = {
  toll:    '高速・有料道路代',
  parking: '駐車場代',
  fuel:    '燃料代・ガソリン代',
  other:   'その他立替経費',
}

const s = StyleSheet.create({
  page:       { padding: 40, fontFamily: 'NotoSansJP', fontSize: 9, color: '#18181b' },
  row:        { flexDirection: 'row', justifyContent: 'space-between' },
  title:      { fontSize: 20, fontWeight: 700, letterSpacing: 4, marginBottom: 16 },
  name:       { fontSize: 11, fontWeight: 700, marginBottom: 4 },
  highlight:  { borderWidth: 2, borderColor: '#18181b', borderRadius: 6, padding: 12, marginVertical: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  highlightAmt: { fontSize: 16, fontWeight: 700 },
  sectionTitle: { fontSize: 8, color: '#71717a', marginBottom: 6, marginTop: 8, letterSpacing: 2 },
  tableHead:  { flexDirection: 'row', borderBottomWidth: 2, borderBottomColor: '#18181b', paddingBottom: 4, marginBottom: 4 },
  tableRow:   { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#f4f4f5', paddingVertical: 3 },
  th:         { fontSize: 8, color: '#52525b', fontWeight: 700 },
  td:         { fontSize: 8 },
  subtotal:   { flexDirection: 'row', justifyContent: 'flex-end', gap: 16, marginBottom: 8, fontSize: 8, color: '#52525b' },
  totals:     { marginTop: 12, alignSelf: 'flex-end', width: 240 },
  totalRow:   { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 3 },
  deductRow:  { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 3, color: '#b45309' },
  totalBold:  { flexDirection: 'row', justifyContent: 'space-between', borderTopWidth: 2, borderTopColor: '#18181b', paddingTop: 4, marginTop: 4, fontWeight: 700 },
  bankBox:    { marginTop: 16, padding: 10, borderWidth: 1, borderColor: '#e4e4e7', borderRadius: 4, backgroundColor: '#fafafa' },
  bankTitle:  { fontSize: 8, fontWeight: 700, marginBottom: 6, color: '#52525b' },
  bankLine:   { fontSize: 8, marginBottom: 2 },
  footer:     { marginTop: 16, paddingTop: 10, borderTopWidth: 1, borderTopColor: '#e4e4e7', fontSize: 7, color: '#a1a1aa' },
})

function yen(n: number) {
  return `¥${n.toLocaleString('ja-JP')}`
}

function fmtDate(iso: string) {
  if (!iso) return ''
  const [y, m, d] = iso.split('-')
  return `${y}年${Number(m)}月${Number(d)}日`
}

export default function PaymentNoticePdfTemplate({ data }: { data: PaymentNoticePdfTemplateData }) {
  const isUnregistered = !data.isInvoiceRegistered
  const deductPct = Math.round(data.deductionRate * 100)

  return (
    <Document title={`支払通知書 ${data.contractorName}`}>
      <Page size="A4" style={s.page}>
        <View style={s.row}>
          <View>
            <Text style={s.title}>支 払 通 知 書</Text>
            <Text style={s.name}>{data.contractorName} 様</Text>
            <Text style={{ fontSize: 8, color: '#71717a' }}>
              対象: {data.noticeMonth} / インボイス: {isUnregistered ? '未登録（経過措置適用）' : '登録事業者'}
            </Text>
          </View>
          <View style={{ textAlign: 'right', fontSize: 8, color: '#52525b' }}>
            <Text style={{ fontSize: 10, fontWeight: 700, color: '#18181b' }}>{COMPANY.name}</Text>
            <Text>発行日: {fmtDate(data.issueDate)}</Text>
            <Text>TEL: {COMPANY.phone}</Text>
          </View>
        </View>

        <View style={s.highlight}>
          <Text>差引支払額（今月お支払い予定額）</Text>
          <Text style={s.highlightAmt}>{yen(data.totalAmount)}</Text>
        </View>

        <Text style={s.sectionTitle}>【 労 務 報 酬 】</Text>
        <View style={s.tableHead}>
          <Text style={[s.th, { width: '18%' }]}>日付</Text>
          <Text style={[s.th, { width: '42%' }]}>案件名</Text>
          <Text style={[s.th, { width: '15%', textAlign: 'right' }]}>数量</Text>
          <Text style={[s.th, { width: '25%', textAlign: 'right' }]}>金額（税抜）</Text>
        </View>
        {data.laborLines.length === 0 ? (
          <Text style={{ textAlign: 'center', color: '#a1a1aa', paddingVertical: 10 }}>稼働データなし</Text>
        ) : (
          data.laborLines.map((line, i) => (
            <View key={i} style={s.tableRow}>
              <Text style={[s.td, { width: '18%' }]}>{fmtDate(line.workDate)}</Text>
              <Text style={[s.td, { width: '42%' }]}>{line.projectName}</Text>
              <Text style={[s.td, { width: '15%', textAlign: 'right' }]}>{line.quantity}</Text>
              <Text style={[s.td, { width: '25%', textAlign: 'right' }]}>{yen(line.netAmount)}</Text>
            </View>
          ))
        )}
        <View style={s.subtotal}>
          <Text>労務報酬 小計（税抜）: {yen(data.laborNet)}</Text>
          {data.laborTax > 0 && <Text>消費税: {yen(data.laborTax)}</Text>}
        </View>

        <Text style={s.sectionTitle}>【 立 替 経 費 】</Text>
        <View style={s.tableHead}>
          <Text style={[s.th, { width: '18%' }]}>日付</Text>
          <Text style={[s.th, { width: '27%' }]}>種別</Text>
          <Text style={[s.th, { width: '18%', textAlign: 'right' }]}>税抜</Text>
          <Text style={[s.th, { width: '18%', textAlign: 'right' }]}>消費税</Text>
          <Text style={[s.th, { width: '19%', textAlign: 'right' }]}>小計</Text>
        </View>
        {data.expenseLines.length === 0 ? (
          <Text style={{ textAlign: 'center', color: '#a1a1aa', paddingVertical: 10 }}>立替経費なし</Text>
        ) : (
          data.expenseLines.map((line, i) => (
            <View key={i} style={s.tableRow}>
              <Text style={[s.td, { width: '18%' }]}>{fmtDate(line.expenseDate)}</Text>
              <Text style={[s.td, { width: '27%' }]}>{EXPENSE_TYPE_LABEL[line.expenseType] ?? line.expenseType}</Text>
              <Text style={[s.td, { width: '18%', textAlign: 'right' }]}>{yen(line.netAmount)}</Text>
              <Text style={[s.td, { width: '18%', textAlign: 'right' }]}>{yen(line.taxAmount)}</Text>
              <Text style={[s.td, { width: '19%', textAlign: 'right' }]}>{yen(line.netAmount + line.taxAmount)}</Text>
            </View>
          ))
        )}
        <View style={s.subtotal}>
          <Text>経費 小計（税抜）: {yen(data.expenseNet)}</Text>
          {data.expenseTax > 0 && <Text>消費税: {yen(data.expenseTax)}</Text>}
        </View>

        <View style={s.totals}>
          <View style={s.totalRow}>
            <Text>労務報酬（税込）</Text>
            <Text>{yen(data.laborNet + data.laborTax)}</Text>
          </View>
          <View style={s.totalRow}>
            <Text>立替経費（税込）</Text>
            <Text>{yen(data.expenseNet + data.expenseTax)}</Text>
          </View>
          {data.deduction > 0 && (
            <View style={s.deductRow}>
              <Text>経過措置控除（{deductPct}%減額）</Text>
              <Text>−{yen(data.deduction)}</Text>
            </View>
          )}
          <View style={s.totalBold}>
            <Text>差引支払額</Text>
            <Text>{yen(data.totalAmount)}</Text>
          </View>
        </View>

        {(data.bankName || data.accountNumber) && (
          <View style={s.bankBox}>
            <Text style={s.bankTitle}>振込先口座</Text>
            <Text style={s.bankLine}>{data.bankName} {data.bankBranch}</Text>
            <Text style={s.bankLine}>{data.accountType} {data.accountNumber}</Text>
            <Text style={s.bankLine}>口座名義: {data.accountHolder}</Text>
          </View>
        )}

        <View style={s.footer}>
          {isUnregistered && data.deduction > 0 && (
            <Text>※ インボイス未登録業者への支払いのため、経過措置（仕入税額控除{deductPct}%相当）を適用しています。</Text>
          )}
          <Text>※ ご不明点は {COMPANY.phone} までお問い合わせください。</Text>
        </View>
      </Page>
    </Document>
  )
}

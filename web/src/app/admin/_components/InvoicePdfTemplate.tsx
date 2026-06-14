import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
} from '@react-pdf/renderer'
import type { InvoicePdfTemplateData } from '@/app/_actions/pdfActions'
import { ensurePdfFonts } from '@/utils/pdf/registerFonts'

ensurePdfFonts()

const COMPANY = {
  name:       process.env.NEXT_PUBLIC_COMPANY_NAME       ?? '○○運送有限会社',
  invoiceReg: process.env.NEXT_PUBLIC_INVOICE_REG_NUMBER ?? 'T0000000000000',
  phone:      process.env.NEXT_PUBLIC_COMPANY_PHONE      ?? '000-0000-0000',
  email:      process.env.NEXT_PUBLIC_COMPANY_EMAIL      ?? 'info@example.com',
  address:    process.env.NEXT_PUBLIC_COMPANY_ADDRESS    ?? '〒000-0000 東京都○○区',
}

const s = StyleSheet.create({
  page:       { padding: 40, fontFamily: 'NotoSansJP', fontSize: 9, color: '#18181b' },
  row:        { flexDirection: 'row', justifyContent: 'space-between' },
  title:      { fontSize: 20, fontWeight: 700, letterSpacing: 4, marginBottom: 16 },
  clientName: { fontSize: 11, fontWeight: 700, marginBottom: 4 },
  metaBox:    { borderWidth: 1, borderColor: '#e4e4e7', borderRadius: 4, padding: 8, marginRight: 8, minWidth: 100 },
  metaLabel:  { fontSize: 7, color: '#71717a' },
  metaValue:  { fontSize: 9, fontWeight: 700, marginTop: 2 },
  highlight:  { borderWidth: 2, borderColor: '#18181b', borderRadius: 6, padding: 12, marginVertical: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  highlightAmt: { fontSize: 16, fontWeight: 700 },
  sectionTitle: { fontSize: 8, color: '#71717a', marginBottom: 6, letterSpacing: 2 },
  tableHead:  { flexDirection: 'row', borderBottomWidth: 2, borderBottomColor: '#18181b', paddingBottom: 4, marginBottom: 4 },
  tableRow:   { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#f4f4f5', paddingVertical: 3 },
  th:         { fontSize: 8, color: '#52525b', fontWeight: 700 },
  td:         { fontSize: 8 },
  colDate:    { width: '18%' },
  colName:    { width: '42%' },
  colQty:     { width: '15%', textAlign: 'right' },
  colAmt:     { width: '25%', textAlign: 'right' },
  totals:     { marginTop: 12, alignSelf: 'flex-end', width: 200 },
  totalRow:   { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 3 },
  totalBold:  { flexDirection: 'row', justifyContent: 'space-between', borderTopWidth: 2, borderTopColor: '#18181b', paddingTop: 4, marginTop: 4, fontWeight: 700 },
  footer:     { marginTop: 24, paddingTop: 12, borderTopWidth: 1, borderTopColor: '#e4e4e7', fontSize: 7, color: '#a1a1aa' },
})

function yen(n: number) {
  return `¥${n.toLocaleString('ja-JP')}`
}

function fmtDate(iso: string) {
  if (!iso) return ''
  const [y, m, d] = iso.split('-')
  return `${y}年${Number(m)}月${Number(d)}日`
}

export default function InvoicePdfTemplate({ data }: { data: InvoicePdfTemplateData }) {
  return (
    <Document title={`請求書 ${data.invoiceNumber}`}>
      <Page size="A4" style={s.page}>
        <View style={s.row}>
          <View>
            <Text style={s.title}>請　求　書</Text>
            <Text style={s.clientName}>
              {data.clientName}{data.contactName ? ` ${data.contactName}` : ''} 御中
            </Text>
            <Text style={{ fontSize: 8, color: '#71717a' }}>{data.invoiceMonth}</Text>
          </View>
          <View style={{ textAlign: 'right', fontSize: 8, color: '#52525b' }}>
            <Text style={{ fontSize: 10, fontWeight: 700, color: '#18181b' }}>{COMPANY.name}</Text>
            <Text>登録番号 {COMPANY.invoiceReg}</Text>
            <Text>{COMPANY.address}</Text>
            <Text>TEL: {COMPANY.phone}</Text>
            <Text>{COMPANY.email}</Text>
          </View>
        </View>

        <View style={{ flexDirection: 'row', marginTop: 12 }}>
          <View style={s.metaBox}>
            <Text style={s.metaLabel}>請求書番号</Text>
            <Text style={s.metaValue}>{data.invoiceNumber}</Text>
          </View>
          <View style={s.metaBox}>
            <Text style={s.metaLabel}>発行日</Text>
            <Text style={s.metaValue}>{fmtDate(data.issueDate)}</Text>
          </View>
          <View style={s.metaBox}>
            <Text style={s.metaLabel}>お支払期限</Text>
            <Text style={s.metaValue}>{fmtDate(data.dueDate)}</Text>
          </View>
        </View>

        <View style={s.highlight}>
          <Text>合計請求金額（税込）</Text>
          <Text style={s.highlightAmt}>{yen(data.totalAmount)}</Text>
        </View>

        <Text style={s.sectionTitle}>稼 働 明 細</Text>
        <View style={s.tableHead}>
          <Text style={[s.th, s.colDate]}>日付</Text>
          <Text style={[s.th, s.colName]}>案件名</Text>
          <Text style={[s.th, s.colQty]}>数量</Text>
          <Text style={[s.th, s.colAmt]}>金額（税抜）</Text>
        </View>
        {data.lines.length === 0 ? (
          <Text style={{ textAlign: 'center', color: '#a1a1aa', paddingVertical: 16 }}>明細データなし</Text>
        ) : (
          data.lines.map((line, i) => (
            <View key={i} style={s.tableRow}>
              <Text style={[s.td, s.colDate]}>{fmtDate(line.workDate)}</Text>
              <Text style={[s.td, s.colName]}>{line.projectName}</Text>
              <Text style={[s.td, s.colQty]}>{line.quantity}</Text>
              <Text style={[s.td, s.colAmt]}>{yen(line.netAmount)}</Text>
            </View>
          ))
        )}

        <View style={s.totals}>
          <View style={s.totalRow}>
            <Text>小計（税抜）</Text>
            <Text>{yen(data.netTotal)}</Text>
          </View>
          {data.isTaxable && (
            <View style={s.totalRow}>
              <Text>消費税（10%・一括四捨五入）</Text>
              <Text>{yen(data.taxAmount)}</Text>
            </View>
          )}
          <View style={s.totalBold}>
            <Text>合計（税込）</Text>
            <Text>{yen(data.totalAmount)}</Text>
          </View>
        </View>

        <View style={s.footer}>
          <Text>※ 本請求書はインボイス制度（適格請求書等保存方式）に準拠しています。</Text>
          <Text>※ 登録番号 {COMPANY.invoiceReg}</Text>
        </View>
      </Page>
    </Document>
  )
}

// ── おおば様式の請求書・支払明細書を ExcelJS で生成する（純関数・数式なし） ──────
//
// ⚠️ 数式は一切入れない。HIBIKI 側で計算済みの値だけをセルに書く。Excel 側の再計算
//    （手動でのセル編集や別環境での開き直し）で HIBIKI の計算結果とズレる余地を作らない。
// ⚠️ セル座標は見本 xlsx の座標に合わせてある。ずれた場合はテスト側ではなく実装（座標）を直す。

import ExcelJS from 'exceljs'
import type { InvoicePdfData, PaymentNoticePdfData } from '@/app/_actions/pdf-actions'
import { aggregateOobaInvoiceRows } from './ooba-invoice-lines'
import { workMinutesFromHHMM, formatHHMM } from './work-minutes'

const YEN = '#,##0;[Red]-#,##0'

const box = (ws: ExcelJS.Worksheet, ref: string) => {
  const c = ws.getCell(ref)
  c.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } }
  return c
}
const money = (ws: ExcelJS.Worksheet, ref: string, v: number) => {
  const c = box(ws, ref)
  c.value = v
  c.numFmt = YEN
  c.alignment = { horizontal: 'right' }
  return c
}
const text = (ws: ExcelJS.Worksheet, ref: string, v: string | number | null) => {
  const c = box(ws, ref)
  c.value = v ?? ''
  return c
}
/** 'YYYY-MM-DD' → { m, d }（数値） */
const md = (iso: string) => {
  const [, m, d] = iso.split('-').map(Number)
  return { m, d }
}

export function buildOobaInvoiceWorkbook(data: InvoicePdfData): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('請求書', { pageSetup: { paperSize: 9, orientation: 'portrait', fitToPage: true } })
  ws.columns = [{ width: 4 }, { width: 40 }, { width: 16 }, { width: 12 }, { width: 16 }]
  const c = data.company

  ws.getCell('A1').value = '請 求 書'
  ws.getCell('A1').font = { size: 18, bold: true }
  ws.mergeCells('A1:E1')
  ws.getCell('A1').alignment = { horizontal: 'center' }

  ws.getCell('A3').value = `${data.clientName} 御中`
  ws.getCell('A3').font = { size: 14, underline: true }
  ws.getCell('D3').value = `作成日 ${data.issueDate.replace(/-(\d+)-(\d+)/, (_, m, d) => `年${Number(m)}月${Number(d)}日`)}`
  ws.getCell('D4').value = c.name
  ws.getCell('D5').value = `〒${c.postalCode}`
  ws.getCell('D6').value = c.address
  ws.getCell('D7').value = `TEL： ${c.phone}`
  ws.getCell('D8').value = `登録番号 ${c.invoiceRegNumber}`

  ws.getCell('A5').value = `件名： ${data.subject}`
  ws.getCell('A6').value = '下記の通り、ご請求申し上げます。'
  ws.getCell('A7').value = `合計金額 ¥${data.totalAmount.toLocaleString('ja-JP')} （税込）`
  ws.getCell('A7').font = { size: 13, bold: true }

  ;['', '摘要', '数量', '単価', '金額'].forEach((h, i) => {
    const cell = text(ws, `${'ABCDE'[i]}8`, h)
    cell.alignment = { horizontal: 'center' }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEEEEEE' } }
  })

  const rows = aggregateOobaInvoiceRows(data.lines, data.yearMonth)
  const MARK = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩']
  for (let i = 0; i < 10; i++) {
    const r = 9 + i
    const row = rows[i]
    text(ws, `A${r}`, row ? (MARK[i] ?? i + 1) : '')
    text(ws, `B${r}`, row?.description ?? '')
    text(ws, `C${r}`, row?.quantityLabel ?? '')
    if (row) {
      money(ws, `D${r}`, row.unitPrice)
      money(ws, `E${r}`, row.amount)
    } else {
      box(ws, `D${r}`)
      box(ws, `E${r}`)
    }
  }

  text(ws, 'D19', '小計')
  money(ws, 'E19', data.netTotal)
  text(ws, 'D20', '消費税')
  money(ws, 'E20', data.taxAmount)
  text(ws, 'D21', '合計')
  money(ws, 'E21', data.totalAmount)
  ws.getCell('E21').font = { bold: true }

  data.noteLines.forEach((n, i) => { ws.getCell(`A${22 + i}`).value = n })
  const b = 24 + data.noteLines.length
  ws.getCell(`A${b}`).value = 'お振込先'
  ws.getCell(`A${b}`).font = { bold: true }
  ws.getCell(`A${b + 1}`).value = `${c.bank.bankName} ${c.bank.bankBranch}　${c.bank.accountType}　${c.bank.accountNumber}`
  ws.getCell(`A${b + 2}`).value = c.bank.accountHolder
  ws.getCell(`A${b + 4}`).value = '備考'

  return wb
}

export function buildOobaPaymentNoticeWorkbook(data: PaymentNoticePdfData): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook()
  const c = data.company
  const monthLabel = data.noticeMonth.replace(/^(\d{4})年0?(\d+)月分$/, '$2月度')
  const subtotal10 = data.laborNet + data.adjustment
  const offsetTotal = -(data.deduction + data.insuranceDeduction)
  const expenseTotal = data.expenseNet + data.expenseTax

  // ── 支払明細書（本票）: 見本のセル座標に合わせる。本票は data.* の確定値を使う ──
  const m = wb.addWorksheet('支払明細書', { pageSetup: { paperSize: 9, fitToPage: true } })
  m.columns = [{ width: 2 }, { width: 14 }, { width: 30 }, { width: 4 }, { width: 4 }, { width: 4 }, { width: 16 }]
  m.getCell('A3').value = '支払明細書'
  m.getCell('A3').font = { size: 16, bold: true }
  m.getCell('G5').value = data.issueDate.replace(/-/g, '/')
  m.getCell('G6').value = `〒${c.postalCode}`
  m.getCell('B7').value = `　${data.contractorName}　`
  m.getCell('D7').value = '様'
  m.getCell('G7').value = c.address
  m.getCell('G8').value = c.name
  m.getCell('G9').value = `℡${c.phone}`
  m.getCell('B10').value = `（${data.noticeMonth})`
  m.getCell('G10').value = `登録番号 ${c.invoiceRegNumber}`
  text(m, 'G11', '金額').alignment = { horizontal: 'center' }
  text(m, 'B12', '支払額')
  text(m, 'C12', '支払運賃')
  money(m, 'G12', data.laborNet)
  text(m, 'C17', '調整')
  money(m, 'G17', data.adjustment)
  text(m, 'C18', '10%対象小計【①】')
  money(m, 'G18', subtotal10)
  text(m, 'C19', '消費税額（10％）【②】')
  money(m, 'G19', data.laborTax)
  text(m, 'B20', '相殺額')
  text(m, 'C21', `${Math.round(data.deductionRate * 100)}%分`)
  money(m, 'G21', -data.deduction)
  text(m, 'C24', '運送保険 (非課税）')
  money(m, 'G24', -data.insuranceDeduction)
  text(m, 'C27', '相殺額合計【③】')
  money(m, 'G27', offsetTotal)
  text(m, 'B28', '立替金（高速料金、駐車場代　他　）')
  money(m, 'G28', data.expenseNet)
  text(m, 'B29', 'うち消費税額（10％）')
  money(m, 'G29', data.expenseTax)
  text(m, 'B31', '立替金合計【④】')
  money(m, 'G31', expenseTotal)
  text(m, 'B32', '差引支給額【①+②+③+④】（税込）').font = { bold: true }
  money(m, 'G32', data.totalAmount)
  m.getCell('G32').font = { bold: true }
  m.getCell('B33').value = '備考          ※送付後10日以内に御連絡が無い場合、確認済とします。'

  // ── 勤務報告書: 合計行はこのシート上の行の合計（Task 8 の HTML 帳票と同じ規則） ──
  const r = wb.addWorksheet('勤務報告書', { pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true } })
  r.getCell('A1').value = `　${monthLabel}勤務報告書（${data.contractorName}）`
  r.getCell('A1').font = { size: 14, bold: true }
  const H3: Record<string, string> = { B: '月', C: '日', D: '作業内容', H: '売上', I: '支払額', J: '立替金内訳', K: '立替金額', L: '作業時間', O: '走行距離', P: '備考' }
  for (const [col, h] of Object.entries(H3)) text(r, `${col}3`, h)
  text(r, 'L4', '開始')
  text(r, 'M4', '終了')
  text(r, 'N4', '実働時間')
  let row = 5
  for (const l of data.laborLines) {
    const { m: mm, d } = md(l.workDate)
    text(r, `B${row}`, mm)
    text(r, `C${row}`, d)
    text(r, `D${row}`, l.projectName)
    money(r, `H${row}`, l.sellingAmount)
    money(r, `I${row}`, l.netAmount)
    text(r, `L${row}`, l.startTime)
    text(r, `M${row}`, l.endTime)
    text(r, `N${row}`, formatHHMM(workMinutesFromHHMM(l.startTime, l.endTime, l.breakMinutes)))
    row++
  }
  for (const e of data.expenseLines) {
    const { m: mm, d } = md(e.expenseDate)
    text(r, `B${row}`, mm)
    text(r, `C${row}`, d)
    text(r, `J${row}`, e.expenseType)
    money(r, `K${row}`, e.netAmount + e.taxAmount)
    row++
  }
  const repLaborSelling = data.laborLines.reduce((s, l) => s + l.sellingAmount, 0)
  const repLaborNet = data.laborLines.reduce((s, l) => s + l.netAmount, 0)
  const repExpenseTotal = data.expenseLines.reduce((s, e) => s + e.netAmount + e.taxAmount, 0)
  text(r, `D${row}`, '合計')
  money(r, `H${row}`, repLaborSelling)
  money(r, `I${row}`, repLaborNet)
  money(r, `K${row}`, repExpenseTotal)

  // ── 作業明細支払書: 合計はこのシート上の行の合計 ──
  const w = wb.addWorksheet('作業明細支払書', { pageSetup: { paperSize: 9, fitToPage: true } })
  w.getCell('A1').value = '作業明細支払書'
  w.getCell('A1').font = { size: 14, bold: true }
  ;([['B', '月'], ['C', '日'], ['D', '作業内容'], ['H', '金額（税抜）'], ['I', '備考']] as const).forEach(([col, h]) => text(w, `${col}3`, h))
  row = 4
  for (const l of data.laborLines) {
    const { m: mm, d } = md(l.workDate)
    text(w, `B${row}`, mm)
    text(w, `C${row}`, d)
    text(w, `D${row}`, l.projectName)
    money(w, `H${row}`, l.netAmount)
    row++
  }
  const workLaborNet = data.laborLines.reduce((s, l) => s + l.netAmount, 0)
  text(w, `D${row}`, '合計')
  money(w, `H${row}`, workLaborNet)

  // ── 立替金明細書: 合計はこのシート上の行の合計 ──
  const x = wb.addWorksheet('立替金明細書', { pageSetup: { paperSize: 9, fitToPage: true } })
  x.getCell('A1').value = '立替金明細書'
  x.getCell('A1').font = { size: 14, bold: true }
  ;([['B', '月'], ['C', '日'], ['D', '作業内容'], ['F', '立替金内訳'], ['G', '売上'], ['H', '立替金額'], ['I', '備考']] as const).forEach(([col, h]) => text(x, `${col}3`, h))
  row = 4
  for (const e of data.expenseLines) {
    const { m: mm, d } = md(e.expenseDate)
    text(x, `B${row}`, mm)
    text(x, `C${row}`, d)
    text(x, `F${row}`, e.expenseType)
    money(x, `H${row}`, e.netAmount + e.taxAmount)
    row++
  }
  const advTotal = data.expenseLines.reduce((s, e) => s + e.netAmount + e.taxAmount, 0)
  text(x, `F${row}`, '合計')
  money(x, `H${row}`, advTotal)

  // ── 利益表（社内用） ──
  const p = wb.addWorksheet('利益表')
  p.getCell('A1').value = '利益表'
  text(p, 'B3', '作業日数合計')
  text(p, 'C3', '作業時間合計')
  text(p, 'D3', '売上（１０％分）')
  const minutes = data.laborLines.reduce((s, l) => s + (workMinutesFromHHMM(l.startTime, l.endTime, l.breakMinutes) ?? 0), 0)
  text(p, 'B4', data.laborLines.length)
  text(p, 'C4', formatHHMM(minutes))
  money(p, 'D4', Math.round(data.laborLines.reduce((s, l) => s + l.sellingAmount, 0) * 0.1))

  return wb
}

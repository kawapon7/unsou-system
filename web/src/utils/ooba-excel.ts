// ── おおば様式の請求書・支払明細書を ExcelJS で生成する（純関数・数式なし） ──────
//
// ⚠️ 数式は一切入れない。HIBIKI 側で計算済みの値だけをセルに書く。Excel 側の再計算
//    （手動でのセル編集や別環境での開き直し）で HIBIKI の計算結果とズレる余地を作らない。
// ⚠️ セル座標は見本 xlsx の座標に合わせてある。ずれた場合はテスト側ではなく実装（座標）を直す。

import ExcelJS from 'exceljs'
import type { InvoicePdfData, PaymentNoticePdfData } from '@/app/_actions/pdf-actions'
import { aggregateOobaInvoiceRows, circledNumber, layoutOobaInvoiceRows } from './ooba-invoice-lines'
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
  // 列: A=月度 B=①② C=摘要 D=日数 E=「日」 F=単価 G=金額（見本 PDF 2026-06 の並び）
  ws.columns = [{ width: 9 }, { width: 9 }, { width: 34 }, { width: 6 }, { width: 4 }, { width: 14 }, { width: 14 }]
  const c = data.company
  const HEAD = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDDEBF7' } } as const

  ws.getCell('A1').value = '請 求 書'
  ws.getCell('A1').font = { size: 18 }
  ws.mergeCells('A1:G1')
  ws.getCell('A1').alignment = { horizontal: 'center' }

  ws.getCell('B3').value = data.clientName
  ws.getCell('B3').font = { size: 14, bold: true }
  ws.getCell('D3').value = '御中'
  ;['B3', 'C3', 'D3'].forEach(r => { ws.getCell(r).border = { bottom: { style: 'medium' } } })
  ws.getCell('F3').value = `作成日 ${data.issueDate.replace(/-(\d+)-(\d+)/, (_, m, d) => `年${Number(m)}月${Number(d)}日`)}`
  ws.getCell('F4').value = `〒${c.postalCode}`
  ws.getCell('F5').value = c.address
  ws.getCell('F6').value = c.name
  ws.getCell('F7').value = `TEL： ${c.phone}`
  ws.getCell('F8').value = `登録番号 ${c.invoiceRegNumber}`

  ws.getCell('B5').value = `件名： ${data.subject}`
  ws.getCell('B5').font = { bold: true }
  ;['B5', 'C5', 'D5'].forEach(r => { ws.getCell(r).border = { bottom: { style: 'double' } } })
  ws.getCell('B6').value = '下記の通り、ご請求申し上げます。'
  ws.getCell('B8').value = '合計金額'
  ws.getCell('B8').font = { size: 13, bold: true }
  ws.getCell('C8').value = data.totalAmount
  ws.getCell('C8').numFmt = '"¥"#,##0'
  ws.getCell('C8').font = { size: 14, bold: true }
  ws.getCell('D8').value = '（税込）'
  ;['B8', 'C8', 'D8'].forEach(r => { ws.getCell(r).border = { bottom: { style: 'double' } } })

  const HEADER_ROW = 10
  text(ws, `A${HEADER_ROW}`, '')
  text(ws, `B${HEADER_ROW}`, '摘要'); ws.mergeCells(`B${HEADER_ROW}:C${HEADER_ROW}`)
  text(ws, `D${HEADER_ROW}`, '数量'); ws.mergeCells(`D${HEADER_ROW}:E${HEADER_ROW}`)
  text(ws, `F${HEADER_ROW}`, '単価')
  text(ws, `G${HEADER_ROW}`, '金額')
  ;['A', 'B', 'D', 'F', 'G'].forEach(col => {
    const cell = ws.getCell(`${col}${HEADER_ROW}`)
    cell.alignment = { horizontal: 'center' }
    cell.font = { bold: true }
    cell.fill = HEAD
  })

  // ⚠️ 明細が固定行数を超える荷主もいる。固定行にすると超過分が印字から消え、
  //    小計/合計は正しい値のまま「合計と明細の合計が合わない」誤発行になる。
  //    見本は17行。最低17行は確保しつつ、明細数に応じて行数を伸ばす（layoutOobaInvoiceRows が担う）。
  const display = layoutOobaInvoiceRows(aggregateOobaInvoiceRows(data.lines, data.yearMonth))
  display.forEach((d, i) => {
    const r = HEADER_ROW + 1 + i
    ;['A', 'B', 'C', 'D', 'E', 'F', 'G'].forEach(col => box(ws, `${col}${r}`))
    if (d.type === 'blank') return
    if (d.type === 'note') {
      ws.getCell(`B${r}`).value = d.text
      ws.getCell(`B${r}`).font = { bold: true }
      return
    }
    const row = d.row
    if (row.groupStart) {
      text(ws, `A${r}`, row.monthLabel).alignment = { horizontal: 'center' }
      text(ws, `B${r}`, circledNumber(row.no)).alignment = { horizontal: 'center' }
    }
    text(ws, `C${r}`, row.description)
    text(ws, `D${r}`, row.days).alignment = { horizontal: 'center' }
    text(ws, `E${r}`, '日')
    money(ws, `F${r}`, row.unitPrice)
    money(ws, `G${r}`, row.amount)
  })

  const totalRow = HEADER_ROW + 1 + display.length
  const label = (ref: string, v: string) => {
    const cell = text(ws, ref, v)
    cell.alignment = { horizontal: 'center' }
    cell.font = { bold: true }
    cell.fill = HEAD
  }
  label(`D${totalRow}`, '小計'); ws.mergeCells(`D${totalRow}:E${totalRow}`)
  money(ws, `F${totalRow}`, data.netTotal); ws.mergeCells(`F${totalRow}:G${totalRow}`)
  // ⚠️ 行位置は固定（後続の備考・お振込先のセル座標が totalRow 基準のため）。非課税時は
  //    値を空にして行だけ残す（HTML 側も同じく空欄）。
  label(`D${totalRow + 1}`, '消費税'); ws.mergeCells(`D${totalRow + 1}:E${totalRow + 1}`)
  if (data.isTaxable) money(ws, `F${totalRow + 1}`, data.taxAmount); else box(ws, `F${totalRow + 1}`)
  ws.mergeCells(`F${totalRow + 1}:G${totalRow + 1}`)
  label(`D${totalRow + 2}`, '合計'); ws.mergeCells(`D${totalRow + 2}:E${totalRow + 2}`)
  money(ws, `F${totalRow + 2}`, data.totalAmount).font = { bold: true }
  ws.mergeCells(`F${totalRow + 2}:G${totalRow + 2}`)

  if (c.bank.bankName && c.bank.accountNumber) {
    ws.getCell(`A${totalRow + 1}`).value = 'お振込先'
    ws.getCell(`B${totalRow + 2}`).value = `${c.bank.bankName}　${c.bank.bankBranch}`
    ws.getCell(`B${totalRow + 3}`).value = `${c.bank.accountType}　${c.bank.accountNumber}`
    ws.getCell(`B${totalRow + 4}`).value = c.bank.accountHolder
  }
  const b = totalRow + 6
  ws.mergeCells(`A${b}:B${b + 3}`)
  const remark = ws.getCell(`A${b}`)
  remark.value = '備考'
  remark.font = { bold: true }
  remark.fill = HEAD
  remark.alignment = { horizontal: 'center', vertical: 'middle' }
  ws.mergeCells(`C${b}:G${b + 3}`)
  for (let r = b; r <= b + 3; r++) ['A', 'B', 'C', 'D', 'E', 'F', 'G'].forEach(col => box(ws, `${col}${r}`))

  return wb
}

export function buildOobaPaymentNoticeWorkbook(
  data: PaymentNoticePdfData,
  opts?: { includeInternalSheets?: boolean },
): ExcelJS.Workbook {
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
  // ⚠️ HTML 帳票側は 0 のとき空欄表示（帳票の慣習で「該当なし」に見せる）。Excel も揃える。
  //    枠線（box）は残すため money() ではなく text() で ''  を入れる。
  if (data.adjustment === 0) text(m, 'G17', '').alignment = { horizontal: 'right' }
  else money(m, 'G17', data.adjustment)
  text(m, 'C18', '10%対象小計【①】')
  money(m, 'G18', subtotal10)
  text(m, 'C19', '消費税額（10％）【②】')
  money(m, 'G19', data.laborTax)
  text(m, 'B20', '相殺額')
  text(m, 'C21', `${Math.round(data.deductionRate * 100)}%分`)
  if (data.deduction === 0) text(m, 'G21', '').alignment = { horizontal: 'right' }
  else money(m, 'G21', -data.deduction)
  text(m, 'C24', '運送保険 (非課税）')
  if (data.insuranceDeduction === 0) text(m, 'G24', '').alignment = { horizontal: 'right' }
  else money(m, 'G24', -data.insuranceDeduction)
  text(m, 'C27', '相殺額合計【③】')
  if (data.deduction === 0 && data.insuranceDeduction === 0) text(m, 'G27', '').alignment = { horizontal: 'right' }
  else money(m, 'G27', offsetTotal)
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

  // ── 利益表（社内用。委託先に渡すワークブックには含めない — includeInternalSheets 時のみ） ──
  if (opts?.includeInternalSheets) {
    const p = wb.addWorksheet('利益表')
    p.getCell('A1').value = '利益表'
    text(p, 'B3', '作業日数合計')
    text(p, 'C3', '作業時間合計')
    text(p, 'D3', '売上（１０％分）')
    const minutes = data.laborLines.reduce((s, l) => s + (workMinutesFromHHMM(l.startTime, l.endTime, l.breakMinutes) ?? 0), 0)
    const workDayCount = new Set(data.laborLines.map(l => l.workDate)).size
    text(p, 'B4', workDayCount)
    text(p, 'C4', formatHHMM(minutes))
    money(p, 'D4', Math.round(data.laborLines.reduce((s, l) => s + l.sellingAmount, 0) * 0.1))
  }

  return wb
}

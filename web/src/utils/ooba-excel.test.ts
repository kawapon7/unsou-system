import { describe, it, expect } from 'vitest'
import { buildOobaInvoiceWorkbook, buildOobaPaymentNoticeWorkbook } from './ooba-excel'
import { OOBA_INVOICE_FIXTURE, OOBA_PAYMENT_NOTICE_FIXTURE } from '@/components/pdf/formats/ooba/fixtures'
import { aggregateOobaInvoiceRows } from './ooba-invoice-lines'
import type { InvoicePdfData, InvoicePdfLine } from '@/app/_actions/pdf-actions'

describe('ooba-excel', () => {
  it('請求書: 件名・明細・合計が所定セルに入る', () => {
    const wb = buildOobaInvoiceWorkbook(OOBA_INVOICE_FIXTURE)
    const ws = wb.getWorksheet('請求書')!
    expect(ws.getCell('A1').value).toBe('請 求 書')
    expect(ws.getCell('A5').value).toBe('件名： R8．6月度 業務委託費')
    expect(ws.getCell('B9').value).toBe('Aデバンニング作業 1本')
    expect(ws.getCell('C9').value).toBe('6月度 14 日')
    expect(ws.getCell('D9').value).toBe(16000)
    expect(ws.getCell('E9').value).toBe(224000)
    const total = OOBA_INVOICE_FIXTURE.totalAmount
    // フィクスチャは3グループ（10行未満）なので slots=10 → 合計行は 9+10+2=21
    const rows = aggregateOobaInvoiceRows(OOBA_INVOICE_FIXTURE.lines, OOBA_INVOICE_FIXTURE.yearMonth)
    const totalRow = 9 + Math.max(10, rows.length)
    expect(totalRow).toBe(19) // 合わせて明示: 3グループなので slots は最低10行のまま
    expect(ws.getCell(`E${totalRow + 2}`).value).toBe(total)
    expect(ws.getCell('E21').value).toBe(total)
  })

  it('請求書: 明細が10件を超えても行が省略されず、合計は明細の下に印字される', () => {
    // 12件のグループ（案件名を変えて1件ずつ）→ 集計後も12行になる
    const lines: InvoicePdfLine[] = Array.from({ length: 12 }, (_, i) => ({
      workDate: `2026-06-${String(i + 1).padStart(2, '0')}`,
      projectName: `案件${i + 1}`,
      quantity: 1,
      netAmount: 10000 + i * 100,
      pieceCount: null,
      isWorkType: false,
    }))
    const netTotal = lines.reduce((s, l) => s + l.netAmount, 0)
    const taxAmount = Math.round(netTotal * 0.1)
    const data: InvoicePdfData = {
      ...OOBA_INVOICE_FIXTURE,
      lines,
      netTotal,
      taxAmount,
      totalAmount: netTotal + taxAmount,
      noteLines: [],
    }
    const wb = buildOobaInvoiceWorkbook(data)
    const ws = wb.getWorksheet('請求書')!
    const rows = aggregateOobaInvoiceRows(data.lines, data.yearMonth)
    expect(rows.length).toBe(12)
    const totalRow = 9 + Math.max(10, rows.length) // 9 + 12 = 21
    // 12番目の行（i=11）は r = 9+11 = 20 に印字される
    expect(ws.getCell('B20').value).toBe('案件12')
    expect(ws.getCell('E20').value).toBe(rows[11].amount)
    expect(ws.getCell(`E${totalRow + 2}`).value).toBe(data.totalAmount)
    expect(totalRow + 2).toBe(23)
  })

  it('支払明細書: includeInternalSheets 指定時は5シート（利益表つき）、未指定は4シート（社内用の利益表を委託先に出さない）', () => {
    const withInternal = buildOobaPaymentNoticeWorkbook(OOBA_PAYMENT_NOTICE_FIXTURE, { includeInternalSheets: true })
    expect(withInternal.worksheets.map(w => w.name)).toEqual(['支払明細書', '勤務報告書', '作業明細支払書', '立替金明細書', '利益表'])

    const withoutInternal = buildOobaPaymentNoticeWorkbook(OOBA_PAYMENT_NOTICE_FIXTURE)
    expect(withoutInternal.worksheets.map(w => w.name)).toEqual(['支払明細書', '勤務報告書', '作業明細支払書', '立替金明細書'])
  })

  it('支払明細書: 差引支給額が入る', () => {
    const wb = buildOobaPaymentNoticeWorkbook(OOBA_PAYMENT_NOTICE_FIXTURE, { includeInternalSheets: true })
    const ws = wb.getWorksheet('支払明細書')!
    const f = OOBA_PAYMENT_NOTICE_FIXTURE
    expect(ws.getCell('G12').value).toBe(f.laborNet)
    expect(ws.getCell('G17').value).toBe(f.adjustment)
    expect(ws.getCell('G18').value).toBe(f.laborNet + f.adjustment)
    expect(ws.getCell('G19').value).toBe(f.laborTax)
    expect(ws.getCell('G21').value).toBe(-f.deduction)
    expect(ws.getCell('G24').value).toBe(-f.insuranceDeduction)
    expect(ws.getCell('G27').value).toBe(-(f.deduction + f.insuranceDeduction))
    expect(ws.getCell('G28').value).toBe(f.expenseNet)
    expect(ws.getCell('G29').value).toBe(f.expenseTax)
    expect(ws.getCell('G31').value).toBe(f.expenseNet + f.expenseTax)
    expect(ws.getCell('G32').value).toBe(f.totalAmount)
    expect(ws.getCell('G32').numFmt).toBe('#,##0;[Red]-#,##0')
    const rep = wb.getWorksheet('勤務報告書')!
    expect(rep.getCell('D5').value).toBe('C配送 2t')
    expect(rep.getCell('N5').value).toBe('8:00') // 実働 9h − 休憩 1h
  })

  it('支払明細書: 運送保険が0円のとき G24 は空欄になる（枠線は残す）', () => {
    const data = { ...OOBA_PAYMENT_NOTICE_FIXTURE, insuranceDeduction: 0 }
    const wb = buildOobaPaymentNoticeWorkbook(data)
    const ws = wb.getWorksheet('支払明細書')!
    expect(ws.getCell('G24').value).toBe('')
    expect(ws.getCell('G24').border?.top?.style).toBe('thin')
  })

  it('支払明細書: 立替金明細書は expenseLines が空でも合計行が4行目に0で入る', () => {
    const data = { ...OOBA_PAYMENT_NOTICE_FIXTURE, expenseLines: [], expenseNet: 0, expenseTax: 0 }
    const wb = buildOobaPaymentNoticeWorkbook(data)
    const adv = wb.getWorksheet('立替金明細書')!
    expect(adv.getCell('F4').value).toBe('合計')
    expect(adv.getCell('H4').value).toBe(0)
  })

  it('明細シートの合計行はシート上の行の合計と一致する', () => {
    const wb = buildOobaPaymentNoticeWorkbook(OOBA_PAYMENT_NOTICE_FIXTURE)
    const rep = wb.getWorksheet('勤務報告書')!
    const laborRowCount = OOBA_PAYMENT_NOTICE_FIXTURE.laborLines.length
    const expenseRowCount = OOBA_PAYMENT_NOTICE_FIXTURE.expenseLines.length
    const totalRow = 5 + laborRowCount + expenseRowCount
    const expectedSelling = OOBA_PAYMENT_NOTICE_FIXTURE.laborLines.reduce((s, l) => s + l.sellingAmount, 0)
    const expectedNet = OOBA_PAYMENT_NOTICE_FIXTURE.laborLines.reduce((s, l) => s + l.netAmount, 0)
    const expectedExpense = OOBA_PAYMENT_NOTICE_FIXTURE.expenseLines.reduce((s, e) => s + e.netAmount + e.taxAmount, 0)
    expect(rep.getCell(`H${totalRow}`).value).toBe(expectedSelling)
    expect(rep.getCell(`I${totalRow}`).value).toBe(expectedNet)
    expect(rep.getCell(`K${totalRow}`).value).toBe(expectedExpense)

    const work = wb.getWorksheet('作業明細支払書')!
    const workTotalRow = 4 + laborRowCount
    expect(work.getCell(`H${workTotalRow}`).value).toBe(expectedNet)

    const adv = wb.getWorksheet('立替金明細書')!
    const advTotalRow = 4 + expenseRowCount
    expect(adv.getCell(`H${advTotalRow}`).value).toBe(expectedExpense)
  })

  it('数式を一切使わない（HIBIKI の計算値だけを入れる）', () => {
    const wb = buildOobaPaymentNoticeWorkbook(OOBA_PAYMENT_NOTICE_FIXTURE)
    const violations: string[] = []
    for (const ws of wb.worksheets) {
      ws.eachRow(row => {
        row.eachCell(cell => {
          if (typeof cell.value === 'object' && cell.value !== null && 'formula' in cell.value) {
            violations.push(`${ws.name}!${cell.address}`)
          }
        })
      })
    }
    expect(violations).toEqual([])

    const wbInv = buildOobaInvoiceWorkbook(OOBA_INVOICE_FIXTURE)
    const invViolations: string[] = []
    for (const ws of wbInv.worksheets) {
      ws.eachRow(row => {
        row.eachCell(cell => {
          if (typeof cell.value === 'object' && cell.value !== null && 'formula' in cell.value) {
            invViolations.push(`${ws.name}!${cell.address}`)
          }
        })
      })
    }
    expect(invViolations).toEqual([])
  })
})

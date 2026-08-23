import { describe, it, expect } from 'vitest'
import { buildOobaInvoiceWorkbook, buildOobaPaymentNoticeWorkbook } from './ooba-excel'
import { OOBA_INVOICE_FIXTURE, OOBA_PAYMENT_NOTICE_FIXTURE } from '@/components/pdf/formats/ooba/fixtures'

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
    expect(ws.getCell('E21').value).toBe(total)
  })

  it('支払明細書: 5 シートがあり差引支給額が入る', () => {
    const wb = buildOobaPaymentNoticeWorkbook(OOBA_PAYMENT_NOTICE_FIXTURE)
    expect(wb.worksheets.map(w => w.name)).toEqual(['支払明細書', '勤務報告書', '作業明細支払書', '立替金明細書', '利益表'])
    const ws = wb.getWorksheet('支払明細書')!
    expect(ws.getCell('G32').value).toBe(OOBA_PAYMENT_NOTICE_FIXTURE.totalAmount)
    expect(ws.getCell('G24').value).toBe(-1000)
    const rep = wb.getWorksheet('勤務報告書')!
    expect(rep.getCell('D5').value).toBe('C配送 2t')
    expect(rep.getCell('N5').value).toBe('8:00') // 実働 9h − 休憩 1h
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

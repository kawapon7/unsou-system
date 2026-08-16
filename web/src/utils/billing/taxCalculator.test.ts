import { describe, it, expect } from 'vitest'
import { calculateInvoiceTax, calculatePaymentTax } from './taxCalculator'

/**
 * 売上請求書（IN・自社が売り手）には経過措置を適用しない。
 *
 * 経過措置は「買い手が、インボイス未登録の売り手から仕入れたとき」に買い手側で使う制度。
 * 売上側で見るべきは自社の登録状況であって取引相手（荷主）の登録状況ではない。
 * 自社は適格請求書発行事業者なので、売上側で差し引きが発生する余地がない。
 * 実請求書（ooba/ の実データ）にも差し引き行は存在しない。
 * 詳細は HANDOVER §5-4 の 2026-07-31「論点B」。
 */
describe('calculateInvoiceTax（売上請求書＝自社が売り手）', () => {
  it('荷主がインボイス未登録でも経過措置を差し引かない', () => {
    // 本番に実在する未登録荷主の2026-07実績と同じ金額
    const result = calculateInvoiceTax([{ amount: 121_950, isTaxable: true }])

    expect(result.subtotal).toBe(121_950)
    expect(result.taxAmount).toBe(12_195)
    expect(result.finalAmount).toBe(134_145) // 差し引き後の 131,462 ではない
  })

  // ⚠️ 「登録済みと未登録で金額が変わらない」という比較テストは、意図的に置いていない。
  //    引数から登録フラグ自体を外したため、差を作ること自体が型で表現できなくなった。
  //    復活させる（＝フラグを引数に戻す）ときは、この論点を読み直すこと。

  it('税抜合計と消費税の合計が請求額になる', () => {
    const result = calculateInvoiceTax([{ amount: 1_000_000, isTaxable: true }])

    expect(result.taxAmount).toBe(100_000)
    expect(result.finalAmount).toBe(1_100_000)
  })

  it('非課税行は消費税の対象外だが合計には含まれる', () => {
    const result = calculateInvoiceTax(
      [
        { amount: 100_000, isTaxable: true },
        { amount: 1_000, isTaxable: false },
      ],
    )

    expect(result.taxableSubtotal).toBe(100_000)
    expect(result.nonTaxableSubtotal).toBe(1_000)
    expect(result.taxAmount).toBe(10_000)
    expect(result.finalAmount).toBe(111_000)
  })
})

/**
 * 支払請求書（OUT・自社が買い手）には経過措置を適用する。
 * こちらが制度本来の向き。委託先が未登録なら、控除できない分を支払から差し引く。
 */
describe('calculatePaymentTax（支払請求書＝自社が買い手）', () => {
  const july = new Date('2026-07-31') // 差し引き2%の期間

  it('委託先がインボイス未登録なら経過措置を差し引く', () => {
    const result = calculatePaymentTax([{ amount: 74_700, isTaxable: true }], false, july)

    expect(result.taxAmount).toBe(7_470)
    expect(result.deductionAmount).toBe(1_643) // (74,700 + 7,470) × 2%
    expect(result.finalAmount).toBe(80_527)
  })

  it('委託先が登録済みなら差し引かない', () => {
    const result = calculatePaymentTax([{ amount: 93_600, isTaxable: true }], true, july)

    expect(result.deductionAmount).toBe(0)
    expect(result.finalAmount).toBe(102_960)
  })

  it('2026年10月1日以降は差し引きが3%になる', () => {
    const october = new Date('2026-10-01')
    const result = calculatePaymentTax([{ amount: 74_700, isTaxable: true }], false, october)

    expect(result.deductionAmount).toBe(2_465) // (74,700 + 7,470) × 3%
  })
})

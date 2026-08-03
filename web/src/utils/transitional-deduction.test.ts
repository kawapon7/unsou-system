import { describe, it, expect } from 'vitest'
import {
  getCreditableRatio,
  getDeductionRate,
  calcTransitionalDeduction,
  TRANSITIONAL_SCHEDULE,
} from './transitional-deduction'
import { getTransitionalDeductionRate as taxTsRate } from './tax'
import { getTransitionalDeductionRate as calcRate } from './billing/taxCalculator'
import { getTransitionDeductionRate as libRate } from '@/lib/invoice'

const d = (s: string) => {
  const [y, m, dd] = s.split('-').map(Number)
  return new Date(y, m - 1, dd)
}

describe('getCreditableRatio（仕入税額控除できる割合）', () => {
  it('制度開始前は全額控除できる', () => {
    expect(getCreditableRatio(d('2023-09-30'))).toBe(1.0)
  })

  it('国税庁の区分どおりの割合を返す', () => {
    expect(getCreditableRatio(d('2023-10-01'))).toBe(0.8)
    expect(getCreditableRatio(d('2026-09-30'))).toBe(0.8)
    expect(getCreditableRatio(d('2026-10-01'))).toBe(0.7)
    expect(getCreditableRatio(d('2028-09-30'))).toBe(0.7)
    expect(getCreditableRatio(d('2028-10-01'))).toBe(0.5)
    expect(getCreditableRatio(d('2030-09-30'))).toBe(0.5)
    expect(getCreditableRatio(d('2030-10-01'))).toBe(0.3)
    expect(getCreditableRatio(d('2031-09-30'))).toBe(0.3)
    expect(getCreditableRatio(d('2031-10-01'))).toBe(0.0)
    expect(getCreditableRatio(d('2040-01-01'))).toBe(0.0)
  })
})

describe('getDeductionRate（差し引き率）', () => {
  // ⚠️ この区分が改訂の本体。旧実装には 3% が存在せず、
  //    2026-10-01 から 5% を引いてしまう状態だった（過大な差し引き＝委託先への支払不足）。
  it('2026年10月1日から3%になる（改訂で新設された区分）', () => {
    expect(getDeductionRate(d('2026-09-30'))).toBe(0.02)
    expect(getDeductionRate(d('2026-10-01'))).toBe(0.03)
  })

  it('全区分の差し引き率', () => {
    expect(getDeductionRate(d('2024-06-15'))).toBe(0.02)
    expect(getDeductionRate(d('2027-01-01'))).toBe(0.03)
    expect(getDeductionRate(d('2029-01-01'))).toBe(0.05)
    expect(getDeductionRate(d('2031-01-01'))).toBe(0.07)
    expect(getDeductionRate(d('2032-01-01'))).toBe(0.10)
  })

  it('登録事業者なら常に0', () => {
    for (const s of ['2024-06-15', '2027-01-01', '2032-01-01']) {
      expect(getDeductionRate(d(s), true)).toBe(0)
    }
  })

  it('浮動小数の誤差が滲まない（0.1 × 0.7 = 0.030000000000000002 を丸める）', () => {
    expect(getDeductionRate(d('2027-01-01'))).toBe(0.03)
    expect(getDeductionRate(d('2031-01-01'))).toBe(0.07)
    // 表示で「3%」「7%」になること
    expect((getDeductionRate(d('2027-01-01')) * 100).toFixed(0)).toBe('3')
    expect((getDeductionRate(d('2031-01-01')) * 100).toFixed(0)).toBe('7')
  })

  it('JST でも 10月1日の切り替わりを1日間違えない（TZズレの回帰テスト）', () => {
    // toISOString を使う実装だと 2026-10-01 が '2026-09-30' に見えて 2% のままになる
    expect(getDeductionRate(new Date(2026, 9, 1))).toBe(0.03)
  })
})

// ⚠️ 再発防止の本体。
//    以前は同じ判定が 3 ファイルに重複しており、3 本とも古い率のままだった。
//    互換のため関数名は残してあるが、中身が正本からズレたらここで落ちる。
describe('旧3実装が正本と一致していること（重複の再発防止）', () => {
  const dates = [
    '2024-06-15', '2026-09-30', '2026-10-01', '2028-10-01',
    '2030-10-01', '2031-10-01', '2032-01-01',
  ]

  it('utils/tax.ts の getTransitionalDeductionRate が正本と一致する', () => {
    for (const s of dates) {
      expect(taxTsRate(d(s))).toBe(getDeductionRate(d(s)))
    }
  })

  it('utils/billing/taxCalculator.ts の getTransitionalDeductionRate が正本と一致する', () => {
    for (const s of dates) {
      expect(calcRate(false, d(s))).toBe(getDeductionRate(d(s)))
      expect(calcRate(true,  d(s))).toBe(0)
    }
  })

  it('lib/invoice.ts の getTransitionDeductionRate が正本と一致する', () => {
    for (const s of dates) {
      expect(libRate(d(s))).toBe(getDeductionRate(d(s)))
    }
  })
})

// ⚠️ ここが今回の本体。率は「対象月」ではなく「課税仕入れを行った日」で決まる
//    （消基通 11-3-1: 役務の提供を受けた日。支払日ではない）。
describe('calcTransitionalDeduction（稼働日ごとの率で差し引く）', () => {
  it('2026-09-21〜10-20 の締め期間で 2% と 3% が混在する', () => {
    const r = calcTransitionalDeduction([
      { date: '2026-09-25', taxIncludedAmount: 110_000 },  // 2% → 2,200
      { date: '2026-09-30', taxIncludedAmount: 110_000 },  // 2% → 合算で 220,000 × 2% = 4,400
      { date: '2026-10-01', taxIncludedAmount: 110_000 },  // 3%
      { date: '2026-10-20', taxIncludedAmount: 110_000 },  // 3% → 合算で 220,000 × 3% = 6,600
    ])

    expect(r.breakdown).toEqual([
      { rate: 0.02, taxIncludedAmount: 220_000, deduction: 4_400 },
      { rate: 0.03, taxIncludedAmount: 220_000, deduction: 6_600 },
    ])
    expect(r.deduction).toBe(11_000)
  })

  it('月単位で判定していたら出る誤った値にはならない', () => {
    const items = [
      { date: '2026-09-25', taxIncludedAmount: 220_000 },
      { date: '2026-10-05', taxIncludedAmount: 220_000 },
    ]
    const correct = calcTransitionalDeduction(items).deduction   // 4,400 + 6,600
    expect(correct).toBe(11_000)
    // 期間まるごと 2% とみなすと 8,800、3% とみなすと 13,200。どちらも誤り
    expect(correct).not.toBe(Math.round(440_000 * 0.02))
    expect(correct).not.toBe(Math.round(440_000 * 0.03))
  })

  it('登録事業者なら0（内訳も空）', () => {
    const r = calcTransitionalDeduction(
      [{ date: '2026-10-01', taxIncludedAmount: 1_000_000 }],
      true,
    )
    expect(r).toEqual({ deduction: 0, breakdown: [] })
  })

  it('対象が無ければ0', () => {
    expect(calcTransitionalDeduction([])).toEqual({ deduction: 0, breakdown: [] })
  })

  it('端数は率のグループごとに1回だけ四捨五入する', () => {
    // 33,333 × 2% = 666.66 → 667
    const r = calcTransitionalDeduction([
      { date: '2026-01-10', taxIncludedAmount: 11_111 },
      { date: '2026-01-20', taxIncludedAmount: 11_111 },
      { date: '2026-01-30', taxIncludedAmount: 11_111 },
    ])
    expect(r.deduction).toBe(667)
    // 行ごとに丸めると 222×3 = 666 になり 1 円ずれる
    expect(r.deduction).not.toBe(Math.round(11_111 * 0.02) * 3)
  })

  it('内訳は率の昇順に並ぶ', () => {
    const r = calcTransitionalDeduction([
      { date: '2029-01-01', taxIncludedAmount: 100 },  // 5%
      { date: '2026-01-01', taxIncludedAmount: 100 },  // 2%
      { date: '2031-01-01', taxIncludedAmount: 100 },  // 7%
    ])
    expect(r.breakdown.map(b => b.rate)).toEqual([0.02, 0.05, 0.07])
  })
})

describe('TRANSITIONAL_SCHEDULE', () => {
  it('開始日の昇順に並んでいる（getCreditableRatio の走査が順序に依存する）', () => {
    const froms = TRANSITIONAL_SCHEDULE.map(p => p.from)
    expect([...froms].sort()).toEqual(froms)
  })
})

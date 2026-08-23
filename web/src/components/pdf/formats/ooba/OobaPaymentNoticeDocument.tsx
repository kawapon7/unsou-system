import type { ReactNode } from 'react'
import type { PaymentNoticePdfData } from '@/app/_actions/pdf-actions'
import { workMinutesFromHHMM, formatHHMM } from '@/utils/work-minutes'

const yen = (n: number) => n.toLocaleString('ja-JP')
const md = (iso: string) => { const [, m, d] = iso.split('-').map(Number); return { m, d } }

const Page = ({ children, last = false }: { children: ReactNode; last?: boolean }) => (
  <div className="a4-page w-[794px] min-h-[1122px] bg-white shadow-xl print:shadow-none p-12 font-sans text-[11px] text-black leading-tight" style={{ pageBreakAfter: last ? 'auto' : 'always' }}>{children}</div>
)
const Th = ({ children, className = '' }: { children?: ReactNode; className?: string }) => <th className={`border border-black px-1 bg-zinc-100 ${className}`}>{children}</th>
const Td = ({ children, className = '', colSpan }: { children?: ReactNode; className?: string; colSpan?: number }) => <td colSpan={colSpan} className={`border border-black px-1 ${className}`}>{children}</td>

/** おおば運送様式 支払明細書 v1（2026-08-23 見本）。本票の項目番号①〜④と差引式は見本どおり */
export function OobaPaymentNoticeDocument({ data }: { data: PaymentNoticePdfData }) {
  const c = data.company
  const subtotal10 = data.laborNet + data.adjustment            // 10%対象小計【①】（調整込み）
  const tax10      = data.laborTax                               // 消費税額【②】
  const offsetTotal = -(data.deduction + data.insuranceDeduction) // 相殺額合計【③】
  const expenseTotal = data.expenseNet + data.expenseTax         // 立替金合計【④】
  const monthLabel = data.noticeMonth.replace(/^(\d{4})年0?(\d+)月分$/, '$2月度')

  // ⚠️ 明細シート（勤務報告書・作業明細支払書・立替金明細書）の合計は、必ず「そのシートに
  //    印字した行」の合計にする。data.laborNet 等（保存済みの支払通知書サブトータル）を
  //    そのまま出すと、行データ（work_records 由来）と数が食い違ったとき合計が行と合わない。
  //    本票（正本）だけは data.* をそのまま使う。
  const sellingTotal    = data.laborLines.reduce((s, l) => s + l.sellingAmount, 0)
  const laborNetRowSum  = data.laborLines.reduce((s, l) => s + l.netAmount, 0)
  const expenseRowSum   = data.expenseLines.reduce((s, e) => s + e.netAmount + e.taxAmount, 0)

  return (
    <>
      {/* ── 支払明細書（本票） ── */}
      <Page>
        <h1 className="text-xl mb-4">支払明細書</h1>
        <div className="flex justify-between">
          <div>
            <p className="text-base">　{data.contractorName}　様</p>
            <p className="mt-3">（{data.noticeMonth}）</p>
          </div>
          <div className="text-right">
            <p>{data.issueDate.replace(/-/g, '/')}</p>
            <p>〒{c.postalCode}</p><p>{c.address}</p><p className="font-semibold">{c.name}</p><p>℡{c.phone}</p>
            <p>登録番号 {c.invoiceRegNumber}</p>
          </div>
        </div>
        <table className="w-full border-collapse mt-4">
          <thead><tr><Th className="w-24"></Th><Th></Th><Th className="w-32">金額</Th></tr></thead>
          <tbody>
            <tr><Td>支払額</Td><Td>支払運賃</Td><Td className="text-right">{yen(data.laborNet)}</Td></tr>
            <tr><Td></Td><Td>調整</Td><Td className="text-right">{data.adjustment === 0 ? '' : yen(data.adjustment)}</Td></tr>
            <tr><Td></Td><Td>10%対象小計【①】</Td><Td className="text-right">{yen(subtotal10)}</Td></tr>
            <tr><Td></Td><Td>消費税額（10％）【②】</Td><Td className="text-right">{yen(tax10)}</Td></tr>
            <tr><Td>相殺額</Td><Td>{Math.round(data.deductionRate * 100)}%分</Td><Td className="text-right">{data.deduction === 0 ? '' : yen(-data.deduction)}</Td></tr>
            <tr><Td></Td><Td>運送保険 (非課税）</Td><Td className="text-right">{data.insuranceDeduction === 0 ? '' : yen(-data.insuranceDeduction)}</Td></tr>
            <tr><Td></Td><Td>相殺額合計【③】</Td><Td className="text-right">{offsetTotal === 0 ? '' : yen(offsetTotal)}</Td></tr>
            <tr><Td colSpan={2}>立替金（高速料金、駐車場代　他　）</Td><Td className="text-right">{yen(data.expenseNet)}</Td></tr>
            <tr><Td colSpan={2}>うち消費税額（10％）</Td><Td className="text-right">{yen(data.expenseTax)}</Td></tr>
            <tr><Td colSpan={2}>立替金合計【④】</Td><Td className="text-right">{yen(expenseTotal)}</Td></tr>
            <tr><Td colSpan={2} className="font-bold">差引支給額【①+②+③+④】（税込）</Td><Td className="text-right font-bold">{yen(data.totalAmount)}</Td></tr>
          </tbody>
        </table>
        <p className="mt-3">備考　※送付後10日以内に御連絡が無い場合、確認済とします。</p>
      </Page>

      {/* ── 勤務報告書 ── */}
      <Page>
        <h1 className="text-lg mb-2">{monthLabel}勤務報告書（{data.contractorName}）</h1>
        <table className="w-full border-collapse">
          <thead>
            <tr><Th>月</Th><Th>日</Th><Th>作業内容</Th><Th>売上</Th><Th>支払額</Th><Th>立替金内訳</Th><Th>立替金額</Th><Th>開始</Th><Th>終了</Th><Th>実働時間</Th><Th>走行距離</Th><Th>備考</Th></tr>
          </thead>
          <tbody>
            {data.laborLines.map((l, i) => { const { m, d } = md(l.workDate); return (
              <tr key={i}><Td>{m}</Td><Td>{d}</Td><Td>{l.projectName}</Td><Td className="text-right">{yen(l.sellingAmount)}</Td><Td className="text-right">{yen(l.netAmount)}</Td><Td></Td><Td></Td><Td>{l.startTime ?? ''}</Td><Td>{l.endTime ?? ''}</Td><Td>{formatHHMM(workMinutesFromHHMM(l.startTime, l.endTime, l.breakMinutes))}</Td><Td></Td><Td></Td></tr>
            )})}
            {data.expenseLines.map((e, i) => { const { m, d } = md(e.expenseDate); return (
              <tr key={`x${i}`}><Td>{m}</Td><Td>{d}</Td><Td></Td><Td></Td><Td></Td><Td>{e.expenseType}</Td><Td className="text-right">{yen(e.netAmount + e.taxAmount)}</Td><Td></Td><Td></Td><Td></Td><Td></Td><Td></Td></tr>
            )})}
            <tr className="font-bold"><Td colSpan={3}>合計</Td><Td className="text-right">{yen(sellingTotal)}</Td><Td className="text-right">{yen(laborNetRowSum)}</Td><Td></Td><Td className="text-right">{yen(expenseRowSum)}</Td><Td colSpan={5}></Td></tr>
          </tbody>
        </table>
      </Page>

      {/* ── 作業明細支払書 ── */}
      <Page>
        <h1 className="text-lg mb-2">作業明細支払書</h1>
        <table className="w-full border-collapse">
          <thead><tr><Th>月</Th><Th>日</Th><Th>作業内容</Th><Th>金額（税抜）</Th><Th>備考</Th></tr></thead>
          <tbody>
            {data.laborLines.map((l, i) => { const { m, d } = md(l.workDate); return (
              <tr key={i}><Td>{m}</Td><Td>{d}</Td><Td>{l.projectName}</Td><Td className="text-right">{yen(l.netAmount)}</Td><Td></Td></tr>
            )})}
            <tr className="font-bold"><Td colSpan={3}>合計</Td><Td className="text-right">{yen(laborNetRowSum)}</Td><Td></Td></tr>
          </tbody>
        </table>
      </Page>

      {/* ── 立替金明細書 ── */}
      <Page last>
        <h1 className="text-lg mb-2">立替金明細書</h1>
        <table className="w-full border-collapse">
          <thead><tr><Th>月</Th><Th>日</Th><Th>作業内容</Th><Th>立替金内訳</Th><Th>売上</Th><Th>立替金額</Th><Th>備考</Th></tr></thead>
          <tbody>
            {data.expenseLines.map((e, i) => { const { m, d } = md(e.expenseDate); return (
              <tr key={i}><Td>{m}</Td><Td>{d}</Td><Td></Td><Td>{e.expenseType}</Td><Td></Td><Td className="text-right">{yen(e.netAmount + e.taxAmount)}</Td><Td></Td></tr>
            )})}
            <tr className="font-bold"><Td colSpan={5}>合計</Td><Td className="text-right">{yen(expenseRowSum)}</Td><Td></Td></tr>
          </tbody>
        </table>
      </Page>
    </>
  )
}

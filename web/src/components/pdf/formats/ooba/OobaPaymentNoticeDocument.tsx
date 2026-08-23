import type { ReactNode } from 'react'
import type { PaymentNoticePdfData } from '@/app/_actions/pdf-actions'
import { workMinutesFromHHMM, formatHHMM } from '@/utils/work-minutes'

const yen = (n: number) => n.toLocaleString('ja-JP')
const md = (iso: string) => { const [, m, d] = iso.split('-').map(Number); return { m, d } }
const jpDate = (iso: string) => { const [y, m, d] = iso.split('-').map(Number); return `${y}年${m}月${d}日` }
// 見本の水色（theme 8 / tint 0.8 ≒ #DDEBF7）
const BLUE = 'bg-[#DDEBF7]'

const Page = ({ children, last = false }: { children: ReactNode; last?: boolean }) => (
  <div className="a4-page w-[794px] min-h-[1122px] bg-white shadow-xl print:shadow-none p-12 font-sans text-[11px] text-black leading-tight" style={{ pageBreakAfter: last ? 'auto' : 'always' }}>{children}</div>
)
const Th = ({ children, className = '', colSpan, rowSpan }: { children?: ReactNode; className?: string; colSpan?: number; rowSpan?: number }) => <th colSpan={colSpan} rowSpan={rowSpan} className={`border border-black px-1 bg-[#DDEBF7] ${className}`}>{children}</th>
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
      {/* ── 支払明細書（本票）: 見本 xlsx「支払明細書」シート（B7 名前・B10 月・G11〜G32 の表）を再現 ── */}
      <Page>
        <h1 className="text-center text-[20px] font-bold mb-6">支払明細書</h1>
        <div className="flex justify-between items-start">
          <div className="w-[330px] pt-10">
            <p className="border-b border-black pb-1 pl-4">
              <span className="text-[20px] font-bold">　{data.contractorName}　</span><span className="text-[18px] ml-4">様</span>
            </p>
            <p className="mt-8 border-b border-black pb-1 pl-4 text-[15px] font-bold">（{data.noticeMonth}）</p>
          </div>
          <div className="w-[300px] text-[13px]">
            <p className="text-right text-[18px]">{jpDate(data.issueDate)}</p>
            <p className="mt-1">〒{c.postalCode}</p>
            <p className="mt-1">{c.address}</p>
            <p className="mt-1 text-[18px]">{c.name}</p>
            <p className="mt-1">℡{c.phone}</p>
            <p className="mt-1 border-b border-black pb-1">登録番号 {c.invoiceRegNumber}</p>
          </div>
        </div>
        <table className="w-full border-collapse mt-1 text-[16px] table-fixed">
          <colgroup><col className="w-[110px]" /><col /><col className="w-[200px]" /></colgroup>
          <tbody>
            <tr className="h-9"><td className="border-0" /><td className="border-0" /><td className={`border border-black text-center ${BLUE}`}>金額</td></tr>
            {/* 支払額ブロック（見本 B12:B19 縦結合、13〜16 行目は空き） */}
            <tr className="h-9"><td rowSpan={8} className="border border-black text-center align-middle">支払額</td><td className="border border-black text-center">支払運賃</td><td className="border border-black text-right pr-2">{yen(data.laborNet)}</td></tr>
            {[0, 1, 2, 3].map(i => <tr key={`s${i}`} className="h-9"><td className="border border-black" /><td className="border border-black" /></tr>)}
            <tr className="h-9"><td className="border border-black text-center">調整</td><td className="border border-black text-right pr-2">{data.adjustment === 0 ? '' : yen(data.adjustment)}</td></tr>
            <tr className="h-9"><td className="border border-black text-right pr-2 font-bold">10%対象小計【①】</td><td className="border border-black text-right pr-2">{yen(subtotal10)}</td></tr>
            <tr className="h-9"><td className="border border-black text-right pr-2 font-bold">消費税額（10％）【②】</td><td className="border border-black text-right pr-2">{yen(tax10)}</td></tr>
            {/* 相殺額ブロック（見本 B20:B27、21 行目 2%分・24 行目 運送保険・27 行目 合計） */}
            <tr className="h-9"><td rowSpan={8} className="border border-black text-center align-middle">相殺額</td><td className="border border-black" /><td className="border border-black" /></tr>
            <tr className="h-9"><td className="border border-black text-center">{Math.round(data.deductionRate * 100)}%分</td><td className="border border-black text-right pr-2">{data.deduction === 0 ? '' : yen(-data.deduction)}</td></tr>
            {[0, 1].map(i => <tr key={`o${i}`} className="h-9"><td className="border border-black" /><td className="border border-black" /></tr>)}
            <tr className="h-9"><td className="border border-black text-center">運送保険 (非課税）</td><td className="border border-black text-right pr-2">{data.insuranceDeduction === 0 ? '' : yen(-data.insuranceDeduction)}</td></tr>
            {[0, 1].map(i => <tr key={`p${i}`} className="h-9"><td className="border border-black" /><td className="border border-black" /></tr>)}
            <tr className="h-9"><td className="border border-black text-right pr-2 font-bold">相殺額合計【③】</td><td className="border border-black text-right pr-2">{offsetTotal === 0 ? '' : yen(offsetTotal)}</td></tr>
            {/* 立替金（見本 G28 は税込合計、G29 は「うち消費税」） */}
            <tr className="h-9"><td colSpan={2} className="border border-black text-center">立替金（高速料金、駐車場代　他　）</td><td className="border border-black text-right pr-2">{yen(expenseTotal)}</td></tr>
            <tr className="h-9"><td colSpan={2} className="border border-black text-right pr-2 text-[13px]">うち消費税額（10％）</td><td className="border border-black text-right pr-2">{yen(data.expenseTax)}</td></tr>
            <tr className="h-9"><td colSpan={2} className="border border-black" /><td className="border border-black" /></tr>
            <tr className="h-9"><td colSpan={2} className="border border-black text-right pr-2 font-bold">立替金合計【④】</td><td className="border border-black text-right pr-2">{yen(expenseTotal)}</td></tr>
            <tr className="h-9"><td colSpan={2} className={`border border-black text-center font-bold ${BLUE}`}>差引支給額【①+②+③+④】（税込）</td><td className="border border-black text-right pr-2 font-bold">{yen(data.totalAmount)}</td></tr>
            <tr className="h-14"><td colSpan={3} className="border border-black align-top pl-2 text-[14px]">備考          ※送付後10日以内に御連絡が無い場合、確認済とします。</td></tr>
          </tbody>
        </table>
      </Page>

      {/* ── 勤務報告書 ── */}
      <Page>
        <h1 className="text-[18px] font-bold mb-2">　{monthLabel.replace('度', '')}勤務報告書（{data.contractorName}）</h1>
        <table className="w-full border-collapse">
          <thead>
            <tr><Th rowSpan={2}>月</Th><Th rowSpan={2}>日</Th><Th rowSpan={2}>作業内容</Th><Th rowSpan={2}>売上</Th><Th rowSpan={2}>支払額</Th><Th rowSpan={2}>立替金内訳</Th><Th rowSpan={2}>立替金額</Th><Th colSpan={3}>作業時間</Th><Th rowSpan={2}>走行距離</Th><Th rowSpan={2}>備考</Th></tr>
            <tr><Th>開始</Th><Th>終了</Th><Th>実働時間</Th></tr>
          </thead>
          <tbody>
            {data.laborLines.map((l, i) => { const { m, d } = md(l.workDate); return (
              <tr key={i}><Td>{m}</Td><Td>{d}</Td><Td>{l.projectName}</Td><Td className="text-right">{yen(l.sellingAmount)}</Td><Td className="text-right">{yen(l.netAmount)}</Td><Td></Td><Td></Td><Td>{l.startTime ?? ''}</Td><Td>{l.endTime ?? ''}</Td><Td>{formatHHMM(workMinutesFromHHMM(l.startTime, l.endTime, l.breakMinutes))}</Td><Td></Td><Td></Td></tr>
            )})}
            {data.expenseLines.map((e, i) => { const { m, d } = md(e.expenseDate); return (
              <tr key={`x${i}`}><Td>{m}</Td><Td>{d}</Td><Td></Td><Td></Td><Td></Td><Td>{e.expenseType}</Td><Td className="text-right">{yen(e.netAmount + e.taxAmount)}</Td><Td></Td><Td></Td><Td></Td><Td></Td><Td></Td></tr>
            )})}
            <tr className="font-bold"><Td colSpan={3}>小計</Td><Td className="text-right">{yen(sellingTotal)}</Td><Td className="text-right">{yen(laborNetRowSum)}</Td><Td></Td><Td className="text-right">{yen(expenseRowSum)}</Td><Td colSpan={5}></Td></tr>
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
            <tr className="font-bold"><Td colSpan={3}>小計（税抜）</Td><Td className="text-right">{yen(laborNetRowSum)}</Td><Td></Td></tr>
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
            <tr className="font-bold"><Td colSpan={5}>立替金合計</Td><Td className="text-right">{yen(expenseRowSum)}</Td><Td></Td></tr>
          </tbody>
        </table>
      </Page>
    </>
  )
}

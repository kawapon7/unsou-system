import type { InvoicePdfData } from '@/app/_actions/pdf-actions'
import { aggregateOobaInvoiceRows } from '@/utils/ooba-invoice-lines'

const yen = (n: number) => `¥${n.toLocaleString('ja-JP')}`
const jpDate = (iso: string) => { const [y, m, d] = iso.split('-').map(Number); return `${y}年${m}月${d}日` }

/** おおば運送様式 請求書 v1（2026-08-23 見本）。見た目を変えたら document-formats.ts の version を上げ、旧版を残す */
export function OobaInvoiceDocument({ data }: { data: InvoicePdfData }) {
  const rows = aggregateOobaInvoiceRows(data.lines, data.yearMonth)
  const c = data.company
  return (
    <div className="a4-page w-[794px] min-h-[1122px] bg-white shadow-xl print:shadow-none p-12 font-sans text-[12px] text-black leading-tight">
      <h1 className="text-center text-2xl tracking-[0.5em] mb-6">請 求 書</h1>
      <div className="flex justify-between mb-4">
        <div>
          <p className="text-lg border-b border-black inline-block pr-8">{data.clientName} 御中</p>
          <p className="mt-4">件名： {data.subject}</p>
          <p className="mt-1">下記の通り、ご請求申し上げます。</p>
        </div>
        <div className="text-right">
          <p>作成日 {jpDate(data.issueDate)}</p>
          <p className="mt-2 font-semibold">{c.name}</p>
          <p>〒{c.postalCode}</p>
          <p>{c.address}</p>
          <p>TEL： {c.phone}</p>
          <p>登録番号 {c.invoiceRegNumber}</p>
        </div>
      </div>
      <p className="text-lg mb-3">合計金額 <span className="font-bold underline">{yen(data.totalAmount)}</span> （税込）</p>
      <table className="w-full border-collapse border border-black">
        <thead>
          <tr className="bg-zinc-100">
            <th className="border border-black w-8"></th>
            <th className="border border-black">摘要</th>
            <th className="border border-black w-28">数量</th>
            <th className="border border-black w-20">単価</th>
            <th className="border border-black w-28">金額</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.no}>
              <td className="border border-black text-center">{['①','②','③','④','⑤','⑥','⑦','⑧','⑨','⑩'][r.no - 1] ?? r.no}</td>
              <td className="border border-black px-2">{r.description}</td>
              <td className="border border-black text-center">{r.quantityLabel}</td>
              <td className="border border-black text-right px-2">{r.unitPrice.toLocaleString('ja-JP')}</td>
              <td className="border border-black text-right px-2">{yen(r.amount)}</td>
            </tr>
          ))}
          {Array.from({ length: Math.max(0, 10 - rows.length) }).map((_, i) => (
            <tr key={`e${i}`}><td className="border border-black h-6"></td><td className="border border-black"></td><td className="border border-black"></td><td className="border border-black"></td><td className="border border-black"></td></tr>
          ))}
        </tbody>
        <tfoot>
          <tr><td colSpan={4} className="border border-black text-right px-2">小計</td><td className="border border-black text-right px-2">{yen(data.netTotal)}</td></tr>
          {data.isTaxable && (
            <tr><td colSpan={4} className="border border-black text-right px-2">消費税</td><td className="border border-black text-right px-2">{yen(data.taxAmount)}</td></tr>
          )}
          <tr><td colSpan={4} className="border border-black text-right px-2 font-bold">合計</td><td className="border border-black text-right px-2 font-bold">{yen(data.totalAmount)}</td></tr>
        </tfoot>
      </table>
      {data.noteLines.map((n, i) => <p key={i} className="mt-2">{n}</p>)}
      {c.bank.bankName && c.bank.accountNumber && (
        <div className="mt-6 border border-black p-2 w-2/3">
          <p className="font-semibold">お振込先</p>
          <p>{c.bank.bankName} {c.bank.bankBranch}　{c.bank.accountType}　{c.bank.accountNumber}</p>
          <p>{c.bank.accountHolder}</p>
        </div>
      )}
      <div className="mt-4"><p>備考</p></div>
    </div>
  )
}

import type { InvoicePdfData } from '@/app/_actions/pdf-actions'
import { aggregateOobaInvoiceRows, circledNumber, layoutOobaInvoiceRows } from '@/utils/ooba-invoice-lines'

const yen = (n: number) => `¥${n.toLocaleString('ja-JP')}`
const num = (n: number) => n.toLocaleString('ja-JP')
const jpDate = (iso: string) => { const [y, m, d] = iso.split('-').map(Number); return `${y}年${m}月${d}日` }

// 見本（2026-06 エス.アール.シー宛 PDF）のヘッダー・ラベルの水色
const HEAD_BG = 'bg-[#DDEBF7]'
const CELL = 'border border-black'

/**
 * おおば運送様式 請求書 v1（oobaunsou_mihon の実物 PDF 2026-06 を見て 2026-08-23 に再現）。
 * 見た目を変えたら document-formats.ts の version を上げ、旧版を残す。
 * 印影は companies.seal_image（data URL）を発行元欄の右に重ねる。FAX は companies に列が無いため出さない。
 */
export function OobaInvoiceDocument({ data }: { data: InvoicePdfData }) {
  const rows = layoutOobaInvoiceRows(aggregateOobaInvoiceRows(data.lines, data.yearMonth))
  const c = data.company
  const hasBank = !!(c.bank.bankName && c.bank.accountNumber)
  return (
    <div className="a4-page w-[794px] min-h-[1122px] bg-white shadow-xl print:shadow-none px-14 py-12 font-sans text-[11px] text-black leading-tight">
      <h1 className="text-center text-[22px] tracking-[0.6em] mb-8 font-normal">請 求 書</h1>

      <div className="flex justify-between items-start">
        <div className="w-[400px]">
          <div className="border-b-2 border-black pb-1 pl-10">
            <span className="text-[16px] font-bold">{data.clientName}</span>
            <span className="text-[13px] ml-8">御中</span>
          </div>
          <div className="mt-8 border-b-[3px] border-double border-black pb-1 pl-10">
            <span className="font-bold text-[13px]">件名：</span>
            <span className="text-[13px] ml-2">{data.subject}</span>
          </div>
          <p className="mt-1 pl-16">下記の通り、ご請求申し上げます。</p>
        </div>
        <div className="w-[270px] pt-6 relative">
          <p className="mb-5 pl-10">作成日 <span className="ml-6">{jpDate(data.issueDate)}</span></p>
          <p>〒{c.postalCode}</p>
          <p className="mt-1">{c.address}</p>
          <p className="mt-1">{c.name}</p>
          <p className="mt-1 pl-10">TEL： {c.phone}</p>
          <p className="mt-1">登録番号 {c.invoiceRegNumber}</p>
          {c.sealImage && (
            // 見本: 社名〜登録番号の右に角印が重なる。印刷時も出るよう <img>（背景画像は印刷で消えることがある）
            // eslint-disable-next-line @next/next/no-img-element
            <img src={c.sealImage} alt="" className="absolute right-0 top-[58px] w-[76px] h-[76px] object-contain" />
          )}
        </div>
      </div>

      <div className="mt-12 flex items-end">
        <div className="w-[400px] border-b-[3px] border-double border-black pb-1 pl-10 flex items-baseline">
          <span className="font-bold text-[14px]">合計金額</span>
          <span className="font-bold text-[16px] ml-16">{yen(data.totalAmount)}</span>
          <span className="ml-8">（税込）</span>
        </div>
        <div className="flex-1 ml-6 border-b-[3px] border-double border-black" />
      </div>

      <table className="w-full border-collapse mt-3 table-fixed">
        <colgroup>
          <col className="w-[66px]" /><col className="w-[80px]" /><col className="w-[250px]" />
          <col className="w-[44px]" /><col className="w-[36px]" /><col className="w-[120px]" /><col className="w-[120px]" />
        </colgroup>
        <thead>
          <tr className={`${HEAD_BG} font-bold text-center h-6`}>
            <th className={CELL}></th>
            <th className={CELL} colSpan={2}>摘要</th>
            <th className={CELL} colSpan={2}>数量</th>
            <th className={CELL}>単価</th>
            <th className={CELL}>金額</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            if (r.type === 'blank') {
              return (
                <tr key={i} className="h-6">
                  <td className={CELL}></td><td className={CELL}></td><td className={CELL}></td>
                  <td className={`${CELL} border-r-0`}></td><td className={`${CELL} border-l-0`}></td>
                  <td className={CELL}></td><td className={CELL}></td>
                </tr>
              )
            }
            if (r.type === 'note') {
              return (
                <tr key={i} className="h-6">
                  <td className={CELL}></td>
                  <td className={`${CELL} font-bold pl-1`} colSpan={2}>{r.text}</td>
                  <td className={`${CELL} border-r-0`}></td><td className={`${CELL} border-l-0`}></td>
                  <td className={CELL}></td><td className={CELL}></td>
                </tr>
              )
            }
            const row = r.row
            return (
              <tr key={i} className="h-6">
                <td className={`${CELL} text-center`}>{row.groupStart ? row.monthLabel : ''}</td>
                <td className={`${CELL} text-center`}>{row.groupStart ? circledNumber(row.no) : ''}</td>
                <td className={`${CELL} pl-2 whitespace-nowrap overflow-hidden`}>{row.description}</td>
                <td className={`${CELL} border-r-0 text-center`}>{row.days}</td>
                <td className={`${CELL} border-l-0 text-center`}>日</td>
                <td className={`${CELL} text-right pr-1`}>{num(row.unitPrice)}</td>
                <td className={`${CELL} text-right pr-1`}>{yen(row.amount)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>

      <div className="flex justify-between mt-0">
        <div className="pt-6 pl-1 w-[400px]">
          {hasBank && (
            <>
              <p>お振込先</p>
              <p className="mt-2 pl-16">{c.bank.bankName}　{c.bank.bankBranch}</p>
              <p className="mt-1 pl-20">{c.bank.accountType}　{c.bank.accountNumber}</p>
              <p className="mt-1 pl-20">{c.bank.accountHolder}</p>
            </>
          )}
        </div>
        <table className="border-collapse table-fixed -mt-px">
          <colgroup><col className="w-[80px]" /><col className="w-[240px]" /></colgroup>
          <tbody>
            <tr className="h-6">
              <td className={`${CELL} ${HEAD_BG} text-center font-bold`}>小計</td>
              <td className={`${CELL} text-right pr-1`}>{yen(data.netTotal)}</td>
            </tr>
            <tr className="h-6">
              <td className={`${CELL} ${HEAD_BG} text-center font-bold`}>消費税</td>
              <td className={`${CELL} text-right pr-1`}>{data.isTaxable ? yen(data.taxAmount) : ''}</td>
            </tr>
            <tr className="h-6">
              <td className={`${CELL} ${HEAD_BG} text-center font-bold`}>合計</td>
              <td className={`${CELL} text-right pr-1 font-bold`}>{yen(data.totalAmount)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="mt-8 flex border border-black h-[90px]">
        <div className={`${HEAD_BG} w-[110px] border-r border-black flex items-center justify-center font-bold`}>備考</div>
        <div className="flex-1" />
      </div>
    </div>
  )
}

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { computeInvoicePreview, type InvoicePreview } from '@/app/oyabun/sales/actions'

const TAX_LABEL: Record<string, string> = {
  exclusive: '外税（10%）',
  inclusive: '内税（10%）',
  exempt:    '非課税',
}

// GET /api/hibiki/invoice/html?clientId=xxx&month=YYYY-MM
export async function GET(req: NextRequest) {
  // 認証確認
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  const clientId = req.nextUrl.searchParams.get('clientId')
  const month    = req.nextUrl.searchParams.get('month')

  if (!clientId || !month) {
    return new NextResponse('clientId と month は必須です', { status: 400 })
  }

  const res = await computeInvoicePreview(clientId, month)
  if (res.error || !res.data) {
    return new NextResponse(`エラー: ${res.error ?? '不明'}`, { status: 500 })
  }

  const html = buildInvoiceHtml(res.data)
  return new NextResponse(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  })
}

// ── HTML 生成 ─────────────────────────────────────────────

function buildInvoiceHtml(inv: InvoicePreview): string {
  const yen = (n: number) => `¥${n.toLocaleString('ja-JP')}`
  const taxLabel = TAX_LABEL[inv.taxType] ?? inv.taxType

  const lineRows = inv.lines.map(l => `
    <tr>
      <td>${l.workDate}</td>
      <td>${escHtml(l.projectName)}</td>
      <td style="text-align:right">${l.quantity.toLocaleString('ja-JP')}</td>
      <td style="text-align:right">${yen(l.netAmount)}</td>
      <td>${l.memo ? escHtml(l.memo) : ''}</td>
    </tr>
  `).join('')

  const noDataRow = inv.lines.length === 0
    ? '<tr><td colspan="5" style="text-align:center;padding:32px;color:#9ca3af;">対象期間に勤務記録がありません</td></tr>'
    : ''

  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>請求書 ${escHtml(inv.companyName)} ${inv.invoiceMonth}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: "Hiragino Kaku Gothic ProN", "Hiragino Sans", Meiryo, sans-serif;
           font-size: 13px; color: #111; background: #fff; padding: 30mm 20mm; }
    .invoice-wrapper { max-width: 210mm; margin: 0 auto; }
    .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 24px; }
    .header-left h1 { font-size: 22px; font-weight: 700; letter-spacing: 0.05em; margin-bottom: 4px; }
    .header-left .sub { color: #6b7280; font-size: 12px; }
    .header-right { text-align: right; color: #374151; font-size: 12px; line-height: 1.8; }
    .recipient { margin-bottom: 24px; }
    .recipient .company { font-size: 18px; font-weight: 700; border-bottom: 2px solid #111; padding-bottom: 4px; display: inline-block; }
    .recipient .honorific { font-size: 13px; color: #6b7280; margin-left: 4px; }
    .meta-table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
    .meta-table td { padding: 4px 8px; font-size: 12px; }
    .meta-table .label { color: #6b7280; width: 100px; }
    table.detail { width: 100%; border-collapse: collapse; margin-bottom: 20px; font-size: 12px; }
    table.detail th { background: #f4f4f5; border: 1px solid #e4e4e7; padding: 6px 8px; text-align: left; font-weight: 600; }
    table.detail th.r { text-align: right; }
    table.detail td { border: 1px solid #e4e4e7; padding: 6px 8px; }
    .totals { margin-left: auto; width: 240px; }
    .totals table { width: 100%; border-collapse: collapse; font-size: 13px; }
    .totals td { padding: 5px 8px; }
    .totals .label { color: #6b7280; }
    .totals .amount { text-align: right; font-feature-settings: "tnum"; }
    .totals .grand { font-size: 15px; font-weight: 700; border-top: 2px solid #111; }
    .note { margin-top: 24px; font-size: 11px; color: #9ca3af; }
    .print-btn { position: fixed; top: 16px; right: 16px; padding: 8px 18px; background: #111;
                 color: #fff; border: none; border-radius: 8px; font-size: 13px; cursor: pointer; }
    @media print {
      .print-btn { display: none; }
      body { padding: 15mm; }
      @page { margin: 15mm; size: A4 portrait; }
    }
  </style>
</head>
<body>
  <button class="print-btn" onclick="window.print()">印刷 / PDF保存</button>

  <div class="invoice-wrapper">
    <div class="header">
      <div class="header-left">
        <h1>請　求　書</h1>
        <div class="sub">Invoice</div>
      </div>
      <div class="header-right">
        <div>発行日：${new Date().toLocaleDateString('ja-JP')}</div>
        <div>対象月：${inv.invoiceMonth}</div>
      </div>
    </div>

    <div class="recipient">
      <span class="company">${escHtml(inv.companyName)}</span>
      <span class="honorific">御中</span>
    </div>

    <table class="meta-table">
      <tr>
        <td class="label">担当者</td>
        <td>${inv.contactName ? escHtml(inv.contactName) : '—'}</td>
        <td class="label">消費税区分</td>
        <td>${taxLabel}</td>
      </tr>
      <tr>
        <td class="label">締め日</td>
        <td>${inv.closingDay === '月末' || inv.closingDay === '末日' ? '月末締め' : `${inv.closingDay}日締め`}</td>
        <td class="label">入金予定日</td>
        <td>${inv.dueDate}</td>
      </tr>
    </table>

    <table class="detail">
      <thead>
        <tr>
          <th>稼働日</th>
          <th>案件名</th>
          <th class="r">数量</th>
          <th class="r">金額（税抜）</th>
          <th>備考</th>
        </tr>
      </thead>
      <tbody>
        ${lineRows}${noDataRow}
      </tbody>
    </table>

    <div class="totals">
      <table>
        <tr>
          <td class="label">小計（税抜）</td>
          <td class="amount">${yen(inv.netTotal)}</td>
        </tr>
        <tr>
          <td class="label">消費税（${taxLabel}）</td>
          <td class="amount">${yen(inv.taxTotal)}</td>
        </tr>
        <tr class="grand">
          <td class="label">請求金額合計</td>
          <td class="amount">${yen(inv.grandTotal)}</td>
        </tr>
      </table>
    </div>

    <div class="note">
      ※ 消費税は税抜合計に対して一括計算（四捨五入1回）。インボイス制度（適格請求書等保存方式）準拠。
    </div>
  </div>
</body>
</html>`
}

function escHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

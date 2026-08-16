# AIスキャン検証用のダミー請求書

実在しない会社・口座だけで構成した検証用の請求書。**実データ（`ooba/`）を検証に使わないため**に用意している。

## PDF の作り方

`dummy-invoice.html` から Chrome のヘッドレスで出力する。

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless --disable-gpu --no-pdf-header-footer \
  --print-to-pdf=/tmp/dummy-invoice.pdf \
  "file://$PWD/web/scripts/fixtures/dummy-invoice.html"
```

⚠️ PDF 自体はリポジトリに置かない（200KB超のバイナリで、HTML から何度でも作れるため）。

## 期待される抽出結果

`utils/scan/aiExtractor.ts` の `ExtractedInvoiceData` に対して、この内容が返れば正しい。

| フィールド | 期待値 |
|---|---|
| `issuerName` | 株式会社サンプル陸送 |
| `invoiceDate` | 2026-07-31 |
| `subtotal` | 1024000 |
| `taxAmount` | 102400 |
| `totalAmount` | 1126400 |
| `registrationNumber` | T9876543210987 |
| `invoiceNumber` | DMY-2026-0731 |
| `dueDate` | 2026-08-31 |
| `issuerPhone` | 000-1234-5678 |
| `items` | 4件（396,000 / 329,000 / 279,000 / 20,000） |

明細4件の合計が `subtotal` と一致することも確認する（1,024,000）。

## 画面から流せないときの実行方法

ファイル選択はブラウザネイティブの挙動で、自動操作から `input.files` を差し込んでも
React の `onChange` に届かない。**同一オリジンのページ上から実 API を叩く**のが確実で、
認証・解析・ジョブ保存はすべて本物の経路を通る。

```js
// /admin/scan を開いた状態で、ブラウザのコンソールから実行
const r = await fetch('/__dummy-invoice.pdf')   // public/ に一時的に置いた場合
const f = new File([await r.blob()], 'dummy-invoice.pdf', { type: 'application/pdf' })
const fd = new FormData(); fd.append('file', f)
const res = await fetch('/api/scan/upload', { method: 'POST', body: fd })
console.log(res.status, await res.json())
```

⚠️ `public/` に置いたダミーPDFは検証後に必ず消すこと（デプロイに含めない）。

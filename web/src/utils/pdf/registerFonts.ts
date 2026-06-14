import { Font } from '@react-pdf/renderer'

let registered = false

/** 日本語 PDF 用フォント（初回のみ register） */
export function ensurePdfFonts() {
  if (registered) return
  Font.register({
    family: 'NotoSansJP',
    src:    'https://cdn.jsdelivr.net/gh/googlefonts/noto-cjk@main/Sans/OTF/Japanese/NotoSansCJKjp-Regular.otf',
  })
  registered = true
}

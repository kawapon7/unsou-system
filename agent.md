# AGENT.md

- 開発作業およびコード生成にあたっては、同一階層にある「CLAUDE.md」の共通行動規範（前置き・挨拶の禁止、思考プロセスの出力禁止、トークン削減の徹底、実動コードの遵守）を完全に読み込み、最優先で遵守すること。
- 実装仕様については、ルート直下にある最新の「HANDOVER_MASTER.md」を直接参照し、定義されているアーキテクチャ、データ設計、およびセキュリティ要件（口座情報の暗号化、RLS、Gitコミット前の成果物遮断規約）と完全に同期させること。
- SuperpowersプラグインはクロちゃんCode（Claude Code）にのみ導入する。Cursorには意図的に未登録とする（同一ファイルへの競合操作を防ぐため）。Claude Code で Superpowers スキルを使用する場合も、本仕様書（HANDOVER_MASTER.md）および CLAUDE.md が最優先。`finishing-a-development-branch` 等の git 操作スキルを実行する場合は、必ず HANDOVER_MASTER.md §2-6S（コミット前3ステップ）を先に実行し、`.next/` および `.open-next/` 等のビルド成果物の混入がないことを確認すること。

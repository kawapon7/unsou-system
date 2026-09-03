# 引き継ぎメモ: MacBook Air 側 unsou-system フォルダの廃止と、その過程で判明した事項

作成: 2026-09-02（Air セッション）
宛先: Mac mini 側の開発セッション

## 1. 結論

- Air 側の `~/developer/unsou-system` は削除してよい状態になった（Air にしか無いものは無くなった）。
- 削除の前提として行った作業は下記 2 点。どちらも完了済み。
  1. Air ローカルにしか無かったブランチ `backup/action-queue-shim` を origin へ push した（`origin/backup/action-queue-shim`）。
     内容: 古い main 上に「起動時アクションキュー詰まりの自動解除シム」を 1 コミット乗せたもの。
     同障害の回避策は本流 main に別コミット（a2b182e）で入っているため実質不要。安全のため退避しただけ。
  2. `web/.env.orphaned-secrets.local`（6/15 作成・git 管理外）を削除した。理由は §3。

## 2. Air と mini の env 比較結果（値は一切表示せず、ハッシュ比較のみ）

- Air `web/.env.local`（7/29）: 8 キーすべてが mini `web/.env.local`（8/24）と同値。mini の部分集合。
- Air `web/.env.orphaned-secrets.local`（6/15）: 5 キー。
  - NEXT_PUBLIC_SUPABASE_URL, ENCRYPTION_KEY → mini 現行と同値
  - NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY → 旧形式 JWT（eyJ…）。anon の発行日 2026-06-05 = プロジェクト作成日。mini に存在しない
  - GEMINI_API_KEY → 現行と別値。mini に存在しない

## 3. 判明事項①: 退避ファイルは 6/21 流出時のキーそのもの（高確度）

- HANDOVER_MASTER.md 524 行目: 2026-06-21 に `.open-next/cloudflare/next-env.mjs` 経由で `.env.local` の全シークレットが GitHub に流出し、全キーをローテーションした記録あり。
- 退避ファイルは 6/15 作成で、その後 6/21 までにローテーションした記録なし。→ 流出時に使われていたキーと同一と判断。
- 無効化の確認:
  - 旧 GEMINI_API_KEY: API に投げて 401（現行キーは 200）。**無効化済み。**
  - 旧 Supabase anon / service_role: **検証不能。** プロジェクト `unsou-system`（ref hbpnh…）が Supabase 上で INACTIVE（一時停止）でホスト名が解決されない。
    HANDOVER には「Legacy API Keys の再発行で手こずった」とあるだけで、旧 JWT キーの無効化を確認した記録は無い。
    → プロジェクトを再開する場合は、Settings → API で Legacy JWT keys が無効化済みか確認すること。

## 4. 判明事項②: ENCRYPTION_KEY は 6/21 流出後もローテーションされていない（要対応・B社前）

根拠:
- 流出記録（524 行目）は流出対象として ENCRYPTION_KEY を名指ししている。
- 7/1〜02 の再ローテーション記録（1303 行目）の対象は Cloudflare token / Supabase / Gemini / Resend の 4 種で、ENCRYPTION_KEY は含まれない。
- 6/15 ファイルと mini 現行 `.env.local` の ENCRYPTION_KEY がハッシュ完全一致（6/15 から今日まで同じ値）。
- リポジトリ内に再暗号化スクリプト・キーバージョン管理が存在しない。

未確認:
- Cloudflare Worker 側（`wrangler secret put` 投入分）の ENCRYPTION_KEY の値。ただし本番 DB は開発と共用のため、本番だけ別値ならローカルで口座情報が復号できないはず。同値と考えるのが自然。

なぜ漏れたか（推定）: API キーは再発行で完結するが、暗号化キーは既存の口座データを全件復号→再暗号化しないと差し替えられない。種類の違いで「即時ローテーション」の対象から外れた。

影響: 流出時点で暗号化済み口座データが GitHub 上に無ければ、キー単体では復号対象が無い。危険なのは「その後に暗号化された口座データが旧キーで復号可能なまま流出する」二段構え。B 社導入で実データが増える前に対応するのが妥当。

対応案（mini 側で計画を立てる）:
1. 新キー生成（32 バイト）
2. `utils/crypto.ts` にキーバージョン or 新旧 2 キー併用の復号を追加
3. 暗号化済み列（contractors の口座情報等）を全件再暗号化するスクリプト（トランザクション・バックアップ前提）
4. `.env.local` と Worker secret を新キーへ差し替え、旧キー併用を撤去
※ hibiki-security の発動対象（口座情報・crypto.ts）。

## 5. 判明事項③: mini の `.env.local` が停止中プロジェクトを指している（要確認）

- mini `web/.env.local`（8/24 更新）・`.env.local.local-dev`・`.env.local.test-backup` の NEXT_PUBLIC_SUPABASE_URL はいずれも hbpnh…（INACTIVE）。
- 8 月の本番 DB 作り直しで新組織側へ移行したはずなら、旧プロジェクト停止は意図通りの可能性が高い。ただし現行 `.env.local` が旧を指したままで良いのかは未確認。
- Supabase MCP（Air 側トークン）から見えるプロジェクトは `unsou-system`(INACTIVE) と `gyoumu-calendar`(ACTIVE) の 2 つのみ。新本番 DB は別組織のため見えていない（2026-08-19 計画書の記載通り）。

## 6. Air 側の残作業

- `rm -rf ~/developer/unsou-system`（ワークツリー `.worktrees/overdue-invoice-alert` も同時に消える。origin に push 済み）
- 以後 Air からの開発は CRD 経由で mini セッションを共有する運用。

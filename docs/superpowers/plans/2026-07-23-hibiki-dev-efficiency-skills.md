# HIBIKI開発 効率化スキル Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** HIBIKI開発の時間短縮とトークン削減を、安全性を犠牲にせず実現する2つのスキル（hibiki-dev / hibiki-security）を作り、CLAUDE.md をそれに整合させる。

**Architecture:** `.claude/skills/` 配下に2つのプロジェクトスキルを新規作成。hibiki-dev はタスク冒頭で自動発動し「労力の右サイジング」と「仕様ナビ」で入口を整理する交通整理役。hibiki-security は git操作やDB/口座/不変ログに触れる時だけ呼ばれる軽量ゲートで、規約本文は複製せず既存（CLAUDE.md / HANDOVER §2-6S）を指すのみ。最後に CLAUDE.md のスキル強制起動ルールを「最適選択」へ緩和する。

**Tech Stack:** Markdown（Claude Code スキル形式：YAML frontmatter + 本文）、bash（検証）

## Global Constraints

- **安全第一 → 効率化の順**。効率化が安全と衝突する場合は必ず安全を採る。
- **軽量性の上限（厳守）**: hibiki-dev の SKILL.md ≦100行、hibiki-security の SKILL.md ≦60行。
- **規約本文を複製しない**: hibiki-security は判定と参照先ポインタのみ。規約の実体は CLAUDE.md / HANDOVER §2-6S に一元管理。
- **仕様ナビは節番号(§)のみを持ち、行番号を書かない**（行番号は grep で都度解決し陳腐化を防ぐ）。
- スキル frontmatter は `name`（kebab-case）と `description`（発動条件を含む一文）を必須とする。
- 設計書: `docs/superpowers/specs/2026-07-23-hibiki-dev-efficiency-skills-design.md`

---

### Task 1: hibiki-dev スキル作成

**Files:**
- Create: `.claude/skills/hibiki-dev/SKILL.md`

**Interfaces:**
- Consumes: なし（新規）
- Produces: スキル `hibiki-dev`。開発タスク冒頭で自動発動し、右サイジング宣言＋仕様ナビ手順を提供。hibiki-security を「口座/DB/不変ログ/git」検知時に呼ぶ参照を含む。

- [ ] **Step 1: SKILL.md を作成**

`.claude/skills/hibiki-dev/SKILL.md` に以下を**そのまま**書き込む:

```markdown
---
name: hibiki-dev
description: HIBIKI（運送業SaaS）の実装・調査・修正タスクを始めるときに使う。労力の右サイジングと仕様ナビで、時間とトークンを節約しつつ着手する入口スキル。手動起動は /hibiki-dev。
---

# hibiki-dev — HIBIKI開発の入口（交通整理）

**優先順位**: ①安全第一 → ②時間・トークンの節約。効率化が安全と衝突したら安全を採る。
このスキルは交通整理だけを行い、実装そのものはしない。

## 手順0: セキュリティ先行チェック（段階判定より前）

タスクが **口座情報・DBアクセス・`approval_history`/`notification_logs`（不変ログ）** を
1文字でも含むなら、自動的に最低「中」扱いにし、**hibiki-security スキルを起動**する。
git commit/add に進むときも hibiki-security を起動する。

## 手順1: 労力の右サイジング（一言で宣言してから着手）

| 段階 | 目安 | 手順 |
|---|---|---|
| 些細 | 1ファイルの機械的編集・typo・文言・定数 | 直行。長考・プロセススキル・仕様ナビ不要 |
| 小 | 数ファイル・既存パターン踏襲で完結 | 該当節だけナビ取得→直行。プロセススキル起動しない |
| 中 | 新規機能の一部・複数コンポーネント連携・非自明ロジック | 仕様ナビ＋必要なプロセススキル |
| 大 | 新機能まるごと・複数サブシステム・DB設計変更 | brainstorming→writing-plans をフル起動 |

**安全弁**: 迷ったら重い側に倒す。バグ・不具合報告は段階に関係なく systematic-debugging を通す。

## 手順2: 仕様ナビ（HANDOVER_MASTER.md の全文読み禁止）

全文読み（≒33k）をやめ、目次→該当節だけ（3〜5k）にする。

1. 目次だけ取得: `grep -nE '^#{1,3} ' docs/HANDOVER_MASTER.md`
2. 下表で該当節(§)を特定（表になければ目次から判断）
3. 目次の行番号から「該当節の開始行〜次の見出し」を割り出し、`Read` の offset/limit でその範囲だけ取得

| やりたいこと | 見る節 |
|---|---|
| 現状把握・次に何をやるか | §5-2, §5-3, §5-4 |
| どのファイルを触るか | §5-5 ファイルマップ（最頻の起点） |
| Server Action を書く/直す | §5-6 |
| admin画面の仕様 | §2-3 |
| ドライバーUI | §2-4 |
| データ設計・テーブル | §2-5, §5-7 |
| 認証・権限ルール | §5-8 |
| 音声操作 | §3 |
| 請求書取り込み | §4 |
| 環境変数・起動 | §5-10, §5-11 |
| セキュリティ規約 | §2-6S（hibiki-security 側で参照） |

**節約ルール**: 同一セッションで一度読んだ節は再読しない。些細タスクはナビ自体スキップ。
足りなければ隣接節を1つずつ足す（最初から広く読まない）。
```

- [ ] **Step 2: frontmatter と行数上限を検証**

Run:
```bash
head -4 .claude/skills/hibiki-dev/SKILL.md && echo "---LINES---" && wc -l < .claude/skills/hibiki-dev/SKILL.md
```
Expected: 先頭が `---` / `name: hibiki-dev` / `description:` を含む `---`、行数が **100以下**。

- [ ] **Step 3: 必須要素の存在を検証**

Run:
```bash
grep -c -E "セキュリティ先行チェック|右サイジング|仕様ナビ|grep -nE|全文読み禁止|hibiki-security" .claude/skills/hibiki-dev/SKILL.md
```
Expected: `6`（6要素すべて存在）。

- [ ] **Step 4: コミット**

```bash
git add .claude/skills/hibiki-dev/SKILL.md
git status
git commit -m "feat: hibiki-dev スキル追加（右サイジング＋仕様ナビで開発を効率化）"
```
（git status で `.next/`・`.open-next/` 未混入を目視確認してから commit）

---

### Task 2: hibiki-security スキル作成

**Files:**
- Create: `.claude/skills/hibiki-security/SKILL.md`

**Interfaces:**
- Consumes: hibiki-dev の手順0から起動される。git操作直前にも起動。
- Produces: スキル `hibiki-security`。発動トリガー＋最小チェックリスト＋参照先ポインタ（CLAUDE.md §2 / HANDOVER §2-6S）を提供。規約本文は持たない。

- [ ] **Step 1: SKILL.md を作成**

`.claude/skills/hibiki-security/SKILL.md` に以下を**そのまま**書き込む:

```markdown
---
name: hibiki-security
description: HIBIKIで口座情報・DBアクセス・不変ログ(approval_history/notification_logs)に触れるとき、または git commit/add・デプロイ設定に進む直前に使う軽量セキュリティゲート。既存規約を指すチェックリストで即判定する。
---

# hibiki-security — セキュリティ軽量ゲート

規約本文は複製しない（実体は CLAUDE.md §2 と HANDOVER §2-6S に一元管理）。
ここは「触れたら確認する入口」。該当項目だけ即チェックし「OK/要対応」を一言宣言する。

## 発動トリガー（いずれかに触れたら）

- 口座情報の読み書き・表示・保存
- DBアクセスを書く/変える（Server Action・RLS・クライアント直クエリの疑い）
- `approval_history` / `notification_logs` を扱う
- **git commit/add に進む直前**（最頻・最重要）
- `.env.local` / デプロイ設定 / 認証フラグに触れる

## チェックリスト（判定と参照先のみ）

| # | 確認 | 参照 |
|---|---|---|
| 1 | 口座情報を平文でDBに入れていないか（`utils/crypto.ts` の AES-256-GCM 経由か） | CLAUDE.md §2 |
| 2 | クライアント直クエリになっていないか（全DBアクセスは Server Actions 経由か） | CLAUDE.md §2 |
| 3 | `approval_history`/`notification_logs` に UPDATE/DELETE を書いていないか（INSERTのみ） | CLAUDE.md §2 |
| 4 | コミット前3ステップ（下記）を通したか | HANDOVER §2-6S |
| 5 | `.env.local` の挙動フラグをビルドに焼き込んでいないか（deploy時 `ALLOW_DEV_AUTH_BYPASS=false` 強制） | HANDOVER §2-6S |

## #4 コミット前3ステップ（git操作時は必ず・スキップ禁止）

1. `git status` で `.next/`・`.open-next/` がステージング候補に無いことを確認
2. シークレット漏れスキャン:
   `git diff --cached | grep -E "SERVICE_ROLE_KEY|GEMINI_API_KEY|RESEND_API_KEY|ENCRYPTION_KEY"` が空
3. `git add .` の一括ではなくファイルを明示して add

詳細な背景・事故経緯は HANDOVER §2-6S を参照。
```

- [ ] **Step 2: frontmatter と行数上限を検証**

Run:
```bash
head -4 .claude/skills/hibiki-security/SKILL.md && echo "---LINES---" && wc -l < .claude/skills/hibiki-security/SKILL.md
```
Expected: 先頭が `---` / `name: hibiki-security` / `description:` を含む `---`、行数が **60以下**。

- [ ] **Step 3: 規約複製をしていないこと＋必須要素を検証**

Run:
```bash
grep -c -E "発動トリガー|チェックリスト|コミット前3ステップ|HANDOVER §2-6S|CLAUDE.md §2" .claude/skills/hibiki-security/SKILL.md
```
Expected: `5`（5要素すべて存在）。

- [ ] **Step 4: コミット**

```bash
git add .claude/skills/hibiki-security/SKILL.md
git status
git commit -m "feat: hibiki-security スキル追加（既存規約を指す軽量セキュリティゲート）"
```
（git status で成果物未混入を目視確認してから commit）

---

### Task 3: CLAUDE.md をスキル方針に整合させる

**Files:**
- Modify: `CLAUDE.md:25-26`（§4 スキル活用の優先順位）、`CLAUDE.md:11`（§1 の強制起動文言）

**Interfaces:**
- Consumes: Task 1/2 で作成した hibiki-dev / hibiki-security。
- Produces: 「1%でも該当したら必ず」を「最適選択」へ緩和した CLAUDE.md。安全は緩和対象外を明記。

- [ ] **Step 1: §4（26行目）の強制起動ルールを緩和**

`CLAUDE.md` の以下の行:
```
- superpowersスキル群（brainstorming, systematic-debugging, test-driven-development, writing-plans, verification-before-completion 等）が1%でも適用可能と判断した場合は、必ず呼び出し、その使用を明示すること。
```
を、以下へ置換:
```
- hibiki-dev / hibiki-security を含む各スキル（superpowers 群も対等）を、状況に応じて最適と思われるものを選んで使用し、その使用を明示すること。ただし安全に関わるもの（hibiki-security の発動トリガー該当時、および git コミット前3ステップ）は常に遵守し、この選択の対象外とする。
```

- [ ] **Step 2: §1（11行目）の「省略しない」強制を最適選択に整合**

`CLAUDE.md` の以下の行:
```
- **superpowersスキルを使う場合は必ず「Using [skill] to [purpose]」の宣言を行い、該当スキルのチェックリスト・TODOを可視化すること。省略しない。**
```
を、以下へ置換:
```
- **スキルを使う場合は「Using [skill] to [purpose]」の宣言を行い、該当スキルのチェックリスト・TODOを可視化すること。** どのスキルを使うかは状況に応じて最適に選ぶ（§4参照）。
```

- [ ] **Step 3: 置換結果を検証**

Run:
```bash
grep -n "最適と思われるもの\|この選択の対象外\|状況に応じて最適に選ぶ" CLAUDE.md && echo "---残存NGチェック---" && grep -c "1%でも適用可能と判断した場合は、必ず呼び出し" CLAUDE.md
```
Expected: 前半3文言がヒット、後半の旧文言カウントが `0`。

- [ ] **Step 4: コミット**

```bash
git add CLAUDE.md
git status
git commit -m "docs: CLAUDE.mdのスキル起動ルールを最適選択へ緩和（安全は対象外）"
```

---

### Task 4: 実地スモークテスト（発動と節約の確認）

**Files:**
- なし（動作確認のみ。必要なら自動メモリ更新）

**Interfaces:**
- Consumes: Task 1-3 の成果物。
- Produces: スキルが認識・発動し、仕様ナビが機能することの確認記録。

- [ ] **Step 1: スキルがロード対象として存在するか確認**

Run:
```bash
ls .claude/skills/hibiki-dev/SKILL.md .claude/skills/hibiki-security/SKILL.md
```
Expected: 2ファイルとも存在。

- [ ] **Step 2: 仕様ナビの目次取得が機能するか確認（節約の実証）**

Run:
```bash
grep -nE '^#{1,3} ' docs/HANDOVER_MASTER.md | wc -l && echo "見出し数（この目次だけで全体地図＝全文33k読み不要）"
```
Expected: 見出し数が出力される（数十件）。この目次取得＝約1k弱で全体像が把握でき、全文読み33kが不要になることを確認。

- [ ] **Step 3: 新規セッションでの発動を手動確認（ユーザー作業）**

新しい Claude Code セッションで「HIBIKIのServer Actionを1つ直したい」等の開発タスクを投げ、
hibiki-dev が発動し（右サイジング宣言＋§5-6 のピンポイント読み）、
全文読みが起きないことを目視確認する。git に進む場面で hibiki-security が発動することも確認。

- [ ] **Step 4: 自動メモリに記録（任意）**

スキル運用開始を自動メモリに1件記録する（新スキル体制・発動条件・効果指標の起点）。
`memory/` に project タイプで追記し、`MEMORY.md` に1行ポインタを足す。

---

## Self-Review

**1. Spec coverage:**
- 2スキル体制 → Task 1, 2 ✓
- 右サイジング（4段階＋機械的先行チェック＋安全弁） → Task 1 手順0/1 ✓
- 仕様ナビ（全文読み禁止・目次grep・ショートカット表・節番号のみ） → Task 1 手順2 ✓
- hibiki-security（トリガー・チェックリスト・規約非複製・§2-6S参照） → Task 2 ✓
- 軽量性の数値上限（100行/60行） → Task 1 Step2 / Task 2 Step2 で検証 ✓
- 自動発動は hibiki-dev のみ / hibiki-security は非自動 → frontmatter description の書き分けで表現（hibiki-dev=「始めるとき」、hibiki-security=「触れるとき/直前」）✓
- CLAUDE.md 修正（§4 緩和＋安全は対象外） → Task 3 ✓
- 効果指標 before/after → Task 4 Step2 で目次取得の実証、設計書に記載済み ✓

**2. Placeholder scan:** TBD/TODO/「後で」なし。各 SKILL.md の全文と全置換文字列を直書き済み。✓

**3. Type consistency:** スキル名 `hibiki-dev` / `hibiki-security` は全タスクで一貫。参照先表記 `HANDOVER §2-6S` / `CLAUDE.md §2` は Task2 と設計書で一致。検証 grep 文字列は各 SKILL.md 本文と一致。✓

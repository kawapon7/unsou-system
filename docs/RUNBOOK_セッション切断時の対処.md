# セッションが切断されたときの対処

BLACKICE（Mac mini）＋ iPhone の remote-control 構成向け。2026-09-03 作成。

まず落ち着くための一言 — **会話の中身が消えることは、まずありません。** 切れるのは接続で、記録は Mac のディスクに残ります。慌てて新しく作り直すと、無事な記録の上に別の話を重ねることになるので、**必ず「探す」を先にやってください**。

---

## 症状で分岐

| 症状 | どれ？ |
|---|---|
| iPhone の一覧から会話が消えた／アーカイブされた | → **手順A** |
| 一覧にはあるが、返事が返ってこない・操作を受け付けない | → **手順B** |
| そもそも Mac のセッションが1つも出てこない | → **手順B** → だめなら **手順C** |

---

## 手順A：会話を見つけて再開する

### A-1. まず、どこにあるか探す

Mac のターミナルで（iPhone からなら、生きている別セッションに頼めば同じことができます）:

```sh
sh ~/.claude/scripts/recent-sessions.sh ~/dev/unsou-system
```

新しい順に「更新時刻 / セッションID / タイトル」が出ます。

```
09/03 09:04  3812ac35-ea36-4c3f-8ec0-88f9acd545e5  PR作成した方がいいの？
09/03 09:03  8648b281-8d76-46e8-b40c-2efd99a75520  エラー監視の実装
```

**ここに出ていれば、記録は無事です。** 消えたのは接続だけです。

別のフォルダで作業していた場合は、第1引数をそのフォルダに変えてください。

### A-2. 再開する

**Mac のターミナルから:**

```sh
cd ~/dev/unsou-system
claude -r 3812ac35-ea36-4c3f-8ec0-88f9acd545e5
```

ID を覚えていない・選びたいときは、引数なしで対話的に選べます:

```sh
claude -r
```

直前の1本でよければ:

```sh
claude -c
```

**iPhone から:** アプリのアーカイブ一覧を開いて、そのセッションを選べば戻れます（接続が復帰していることが前提。していなければ手順B）。

---

## 手順B：接続（remote-control）を確かめる・直す

### B-1. 生きているか

```sh
launchctl print gui/$(id -u)/com.kawapon.claude-remote-control | grep -E 'state|pid|last exit'
```

`state = running` かつ PID が出ていれば、プロセス自体は生きています。

### B-2. つながっているか（生きている ≠ つながっている）

プロセスが動いていても、接続が切れて再接続をくり返していることがあります。ログの末尾を見ます:

```sh
tail -c 2000 ~/.claude/remote-control.log | grep -aE 'Connected|Reconnecting' | tail -3
```

- `Connected` … つながっています。問題は別のところにあります
- `Reconnecting · retrying in ... · disconnected 42s` … **切れています**。ネットワークが戻れば自力で復帰することが多いので、まず数分待つ

### B-3. それでも戻らないなら再起動

⚠️ **これを実行すると、iPhone とつながっている全セッションが一度切れます。** 他に作業中のものがないか確認してから。

```sh
launchctl kickstart -k gui/$(id -u)/com.kawapon.claude-remote-control
```

30秒ほど待ってから B-2 で `Connected` を確認します。会話の中身は消えません（手順A で再開できます）。

---

## 手順C：それでもだめなとき

### C-1. Mac 自体がネットに出られているか

```sh
ping -c 3 claude.ai
```

### C-2. 常駐の登録が外れていないか

```sh
launchctl list | grep claude
```

`com.kawapon.claude-remote-control` が出てこなければ、登録が外れています:

```sh
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.kawapon.claude-remote-control.plist
```

### C-3. 記録そのものを直接読む

再開できなくても、中身だけは取り出せます。セッションの記録は次の場所にあります:

```
~/.claude/projects/-Users-atsushikawasaki-dev-unsou-system/<セッションID>.jsonl
```

最悪ここを開けば、話した内容は全部残っています。

---

## やってはいけないこと

- **「消えた」と決めつけて、同じ作業を新しいセッションで最初からやり直す** … 記録は残っているので、まず手順A で探す。特に本番作業の途中だった場合、どこまで進んだか分からないまま再実行すると危険
- **確認せずに `launchctl kickstart` する** … 他の作業中セッションを巻き添えで切る
- **`~/.claude/projects/` の中を消す** … これが会話の本体。消したら本当に戻りません

---

## なぜ切れるのか（背景）

remote-control は iPhone と Mac をつなぐ「糸」の役です。ネットワークが一瞬でも途切れると糸が切れ、**切れたままの会話は自動的にアーカイブへ片づけられます**。これは異常ではなく、そういう仕組みです。

くわしい解説は `docs/2026-09-03_セッション消失とログ肥大_やさしい解説.md` を参照。

### 関連して入れてある仕組み

`remote-control` のログは放っておくと1日60MBほど膨らむため、1時間ごとの自動お片づけを入れてあります（`com.kawapon.claude-rc-logrotate`）。過去の切断記録は `~/.claude/logs/` に30世代まで圧縮保存されているので、「いつ切れたか」は後からでも調べられます。

```sh
ls -t ~/.claude/logs/remote-control-*.log.gz | head -5
gzcat ~/.claude/logs/remote-control-<日時>.log.gz | tail -50
```

---

*関連ファイル: `~/.claude/scripts/recent-sessions.sh`, `~/.claude/scripts/rotate-remote-control-log.sh`, `~/Library/LaunchAgents/com.kawapon.claude-remote-control.plist`*

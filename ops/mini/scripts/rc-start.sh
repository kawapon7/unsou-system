#!/bin/sh
# launchd から呼ばれる Remote Control（常駐サーバー）の起動ラッパー。
#
# ねらい（2026-09-05）:
#   1. 10分の通信断でサーバーが終了 → launchd が本スクリプトを再実行 →
#      `--continue` で「このディレクトリで最後に記録されたセッション」に戻る。
#      新サーバーを立てて前のセッションを置き去りにしない。
#   2. `--continue` は「約4時間以内の記録が無いとエラー終了」する仕様。
#      その場合だけ新規起動に切り替える（KeepAlive の無限再起動ループを防ぐ）。
#   3. 画面用の出力（スピナー）は捨て、記録は `--debug-file` へ。
#
# ⚠️ 秘密情報は書かない。パスは $HOME 基準にして機械間で同じ内容を保つ。
CLAUDE="$HOME/.local/bin/claude"
PROJECT="$HOME/dev/unsou-system"
LOGDIR="$HOME/.claude/logs"
DEBUG_LOG="$LOGDIR/remote-control-debug.log"
START_LOG="$LOGDIR/rc-start.log"
QUICK_EXIT_SEC=15   # これより早く落ちたら「引き継ぐ相手が無い」とみなして新規起動（実測: 相手無しは1秒で終了）

mkdir -p "$LOGDIR"
cd "$PROJECT" || exit 1
log(){ echo "[$(date "+%F %T")] rc-start: $*" >> "$START_LOG"; }

# 旧デーモンが完全に消えるまで待つ（新環境が作られる事故の防止）
i=0
others(){ for p in $(pgrep -f "bin/claude remote-control"); do [ "$p" = "$$" ] && continue; ps -o command= -p "$p" | grep -q -- "--help" && continue; echo "$p"; done; }
while [ -n "$(others)" ]; do
  i=$((i+1)); [ $i -ge 60 ] && break
  sleep 1
done

VER=$($CLAUDE --version 2>/dev/null | awk '{print $1}')
echo "$VER" > "$HOME/.claude/rc-running-version"

# まず引き継ぎを試す
log "waited ${i}s, trying --continue ($VER)"
t0=$(date +%s)
$CLAUDE remote-control --continue --debug-file "$DEBUG_LOG"
rc=$?
ran=$(( $(date +%s) - t0 ))
if [ "$ran" -ge "$QUICK_EXIT_SEC" ]; then
  # 長く動いた後の終了＝通信断など。launchd が再実行し、また --continue する
  log "continued session ended after ${ran}s (exit $rc); launchd will restart"
  exit $rc
fi

# すぐ落ちた＝引き継ぐ記録が無い（4時間超・初回など）。新規で立てる
log "--continue exited in ${ran}s (exit $rc); starting fresh server"
exec $CLAUDE remote-control --spawn=same-dir --debug-file "$DEBUG_LOG"

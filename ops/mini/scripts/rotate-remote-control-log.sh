#!/bin/sh
# claude remote-control のログを一定サイズで切り詰める。
#
# 対象（2026-09-05 に --debug-file 化したので2本見る）:
#   ~/.claude/logs/remote-control-debug.log  … 記録専用の出し口（新）
#   ~/.claude/remote-control.log             … 旧 stdout。/dev/null 化後は増えないが念のため
#
# 注意: remote-control は常駐でログの fd を掴み続ける。リネーム方式は効かないので
# in-place truncate（: > file）を使う。掴んだ fd に対しても安全に効く。

set -eu

ARCHIVE_DIR="$HOME/.claude/logs"
MAX_BYTES=20971520   # 20MB を超えたら実行
KEEP_LINES=5000      # アーカイブに残す末尾行数（スピナー除去後）
KEEP_ARCHIVES=30     # 保持する世代数

rotate_one() {
  LOG="$1"; NAME="$2"
  [ -f "$LOG" ] || return 0
  SIZE=$(/usr/bin/stat -f %z "$LOG")
  [ "$SIZE" -gt "$MAX_BYTES" ] || return 0
  mkdir -p "$ARCHIVE_DIR"
  STAMP=$(/bin/date +%Y%m%d-%H%M%S)
  /usr/bin/grep -av 'Reconnecting · retrying' "$LOG" \
    | /usr/bin/awk '$0 != prev { print; prev = $0 }' \
    | /usr/bin/tail -n "$KEEP_LINES" \
    | /usr/bin/gzip -c > "$ARCHIVE_DIR/$NAME-$STAMP.log.gz"
  : > "$LOG"
  /bin/ls -1t "$ARCHIVE_DIR"/"$NAME"-*.log.gz 2>/dev/null \
    | /usr/bin/tail -n +$((KEEP_ARCHIVES + 1)) \
    | while IFS= read -r old; do rm -f "$old"; done
}

rotate_one "$HOME/.claude/logs/remote-control-debug.log" remote-control-debug
rotate_one "$HOME/.claude/remote-control.log" remote-control
exit 0

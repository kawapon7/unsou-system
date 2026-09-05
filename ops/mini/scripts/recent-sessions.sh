#!/bin/sh
# 現在のディレクトリ（または第1引数のディレクトリ）の Claude セッションを、新しい順に一覧する。
# 切断・アーカイブで見失ったセッションの ID を調べ、`claude -r <ID>` で再開するために使う。
#
# 使い方:
#   sh ~/.claude/scripts/recent-sessions.sh          # カレントディレクトリ、10件
#   sh ~/.claude/scripts/recent-sessions.sh ~/dev/x 20

set -eu

DIR=$(cd "${1:-$PWD}" && pwd)
COUNT="${2:-10}"

# Claude はプロジェクトディレクトリのパスの "/" を "-" に置き換えて保存先にしている
STORE="$HOME/.claude/projects/$(printf '%s' "$DIR" | tr '/' '-')"

if [ ! -d "$STORE" ]; then
  echo "セッション履歴が見つかりません: $STORE" >&2
  exit 1
fi

cd "$STORE"
ls -t ./*.jsonl 2>/dev/null | head -n "$COUNT" | while IFS= read -r f; do
  id=$(basename "$f" .jsonl)
  when=$(/usr/bin/stat -f '%Sm' -t '%m/%d %H:%M' "$f")
  label=$(/usr/bin/python3 -c "
import json, sys
title = first = None
for line in open(sys.argv[1], encoding='utf-8'):
    try:
        d = json.loads(line)
    except ValueError:
        continue
    if d.get('type') == 'ai-title':
        title = d.get('aiTitle')
    elif d.get('type') == 'last-prompt' and not first:
        first = d.get('lastPrompt')
print(' '.join((title or first or '(タイトルなし)').split())[:44])
" "$f")
  printf '%s  %s  %s\n' "$when" "$id" "$label"
done

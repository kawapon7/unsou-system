#!/bin/sh
# mini（BLACKICE）の状態を OK/NG 表で出す健康診断。
# 使い方: ssh mini ~/dev/unsou-system/ops/mini/doctor.sh
# NG 行の右端は docs/REMOTE_OPS.md の対処見出し。
# 何も変更しない（読むだけ）。

PROJECT="$HOME/dev/unsou-system"
LABEL=com.kawapon.claude-remote-control
DEBUG_LOG="$HOME/.claude/logs/remote-control-debug.log"
OLD_LOG="$HOME/.claude/remote-control.log"
TMUX=/opt/homebrew/bin/tmux
TS="/Applications/Tailscale.app/Contents/MacOS/Tailscale"
MIN_VER=2.1.228

row(){ printf '%s | %s | %s%s\n' "$1" "$2" "$3" "${4:+ | → $4}"; }
row "判定" "項目" "いま" "NG のとき見る見出し"
echo "---"


# 1. Tailscale
if [ -x "$TS" ]; then
  st=$("$TS" status --self=true --peers=false 2>/dev/null | awk 'NR==1{print $1, $2}')
  case "$st" in 100.*) row OK "Tailscale" "$st" "";; *) row NG "Tailscale" "${st:-not running}" "内線(Tailscale)が落ちた";; esac
else
  row NG "Tailscale" "app not found" "内線(Tailscale)が落ちた"
fi

# 2. remote-control 常駐（launchd）
lp=$(launchctl print gui/$(id -u)/$LABEL 2>/dev/null)
state=$(echo "$lp" | awk -F'= ' '/^\tstate = /{print $2; exit}')
pid=$(echo "$lp" | awk -F'= ' '/^\tpid = /{print $2; exit}')
if [ "$state" = "running" ]; then
  et=$(ps -o etime= -p "$pid" 2>/dev/null | tr -d ' ')
  row OK "remote-control 常駐" "running pid=$pid up=$et" ""
else
  row NG "remote-control 常駐" "${state:-not loaded}" "常駐(remote-control)が止まった"
fi

# 3. remote-control の接続状態（ログ末尾）
#   debug ログ（新）: 「Starting poll loop」「Registered」= つながった。
#                    その後に「Reconnecting / ECONN / ETIMEDOUT / fetch failed」が出ていれば不調。
#   旧 stdout ログ  : 「Connected ·」「Reconnecting ·」のスピナー行。
if [ -s "$DEBUG_LOG" ]; then
  src="$DEBUG_LOG"
  tail -c 30000 "$src" > /tmp/doctor-rc-tail.$$ 2>/dev/null
  okline=$(grep -anE 'Starting poll loop|Registered, server|Reconnected after' /tmp/doctor-rc-tail.$$ | tail -1 | cut -d: -f1)
  ngline=$(grep -anEi 'Reconnecting|ECONNRESET|ETIMEDOUT|ENOTFOUND|fetch failed|Reconnect attempt' /tmp/doctor-rc-tail.$$ | tail -1 | cut -d: -f1)
  rm -f /tmp/doctor-rc-tail.$$
  if [ -z "$okline" ] && [ -z "$ngline" ]; then last=""; elif [ "${ngline:-0}" -gt "${okline:-0}" ]; then last=Reconnecting; else last=Connected; fi
else
  src="$OLD_LOG"
  last=$(tail -c 20000 "$src" 2>/dev/null | grep -aoE '(Connected|Reconnecting) ·' | tail -1 | awk '{print $1}')
fi
age=$(( $(date +%s) - $(stat -f %m "$src" 2>/dev/null || echo 0) ))
case "$last" in
  Connected) row OK "remote-control 接続" "$last ($(basename "$src"))" "";;
  "") row "?" "remote-control 接続" "ログに手がかりなし ($(basename "$src"))" "常駐(remote-control)が止まった";;
  Reconnecting)
    # サーバーは約10分つながらないと終了する。最後の不調から10分以上たって
    # まだ同じ pid が動いているなら、つなぎ直せたと判断する
    if [ "$state" = "running" ] && [ "$age" -gt 600 ]; then
      row OK "remote-control 接続" "不調のあと $((age/60)) 分生存＝再接続済みと推定" ""
    else
      row NG "remote-control 接続" "$last ${age}s 前 ($(basename "$src"))" "つながらない(Reconnecting)"
    fi;;
esac

# 4. デスクトップアプリ
if ps -axo comm= | grep -q "^/Applications/Claude.app/Contents/MacOS/Claude$"; then row OK "Claude デスクトップ" "running" ""; else row NG "Claude デスクトップ" "not running" "デスクトップアプリが落ちた"; fi

# 5. claude のバージョン
ver=$("$HOME/.local/bin/claude" --version 2>/dev/null | awk '{print $1}')
if [ -n "$ver" ] && [ "$(printf '%s\n%s\n' "$MIN_VER" "$ver" | sort -V | head -1)" = "$MIN_VER" ]; then row OK "claude --version" "$ver (>= $MIN_VER)" ""; else row NG "claude --version" "${ver:-not found} (< $MIN_VER)" "claude を更新する"; fi

# 6. tmux hibiki
if [ -x "$TMUX" ] && "$TMUX" has-session -t hibiki 2>/dev/null; then
  n=$("$TMUX" ls 2>/dev/null | wc -l | tr -d ' ')
  row OK "tmux hibiki" "あり（机は全部で $n）" ""
else
  row "--" "tmux hibiki" "なし（ssh で座れば作られる）" "机(tmux)に座る"
fi

# 7. dev サーバー 3000
p3000=$(lsof -nP -iTCP:3000 -sTCP:LISTEN 2>/dev/null | awk 'NR==2{print $1"/"$2}')
if [ -n "$p3000" ]; then row "--" "dev サーバー :3000" "起動中 ($p3000)" ""; else row "--" "dev サーバー :3000" "停止中" ""; fi

# 8. スリープ
sl=$(pmset -g 2>/dev/null | awk '/^ sleep /{print $2}'); womp=$(pmset -g 2>/dev/null | awk '/womp/{print $2}')
if [ "$sl" = "0" ] && [ "$womp" = "1" ]; then row OK "スリープ設定" "sleep=0 womp=1" ""; else row NG "スリープ設定" "sleep=$sl womp=$womp" "mini が寝る"; fi

# 9. 回線（有線か）
en0=$(ifconfig en0 2>/dev/null | awk '/status:/{print $2}')
wifi=$(ifconfig en1 2>/dev/null | awk '/inet /{print $2}')
if [ "$en0" = "active" ]; then row OK "回線" "有線 en0 active" ""; else row NG "回線" "有線なし（Wi-Fi ${wifi:-?}）" "有線 LAN にする"; fi

# 10. ディスク
avail=$(df -h / | awk 'NR==2{print $4}'); pct=$(df / | awk 'NR==2{print $5}' | tr -d '%')
if [ "$pct" -lt 90 ]; then row OK "ディスク残量" "$avail free (${pct}% used)" ""; else row NG "ディスク残量" "$avail free (${pct}% used)" "ディスクが足りない"; fi

# 11. ログサイズ
for f in "$DEBUG_LOG" "$OLD_LOG"; do
  [ -f "$f" ] || continue
  sz=$(stat -f %z "$f"); mb=$((sz/1048576))
  if [ "$sz" -lt 52428800 ]; then row OK "ログ $(basename "$f")" "${mb}MB" ""; else row NG "ログ $(basename "$f")" "${mb}MB" "ログが太った"; fi
done

# 12. 直近の切断回数（debug ログの Reconnecting 行）
if [ -f "$DEBUG_LOG" ]; then
  rc=$(grep -ac 'Reconnecting' "$DEBUG_LOG" 2>/dev/null)
  row "--" "切断回数(ログ内)" "$rc 回" ""
fi

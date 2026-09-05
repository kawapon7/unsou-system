#!/bin/sh
# 毎晩実行。インストール版とデーモン稼働版が違い、全セッションが idle なら
# 2026-09-05: パスを $HOME 基準に。環境IDの読み取り先を --debug-file のログへ変更（debug ログに environment= が出るかは未検証）
# Remote Control デーモンだけを再起動する。OS・アプリは触らない。
CLAUDE="$HOME/.local/bin/claude"
H="$HOME/.claude"
LOG=$H/logs/rc-update-check.log
LABEL=com.kawapon.claude-remote-control
log(){ echo "[$(date "+%F %T")] $*" >> "$LOG"; }
installed=$($CLAUDE --version 2>/dev/null | awk "{print \$1}")
running=$(cat $H/rc-running-version 2>/dev/null)
if [ -z "$installed" ]; then log "skip: claude --version failed"; exit 0; fi
if [ "$installed" = "$running" ]; then log "same version $installed, nothing to do"; exit 0; fi
# busy 判定1: セッション台帳の status
busy=$(python3 - <<PY
import json,glob
b=[]
for f in glob.glob("$H/sessions/*.json"):
    try: d=json.load(open(f))
    except: continue
    s=d.get("status")
    if s not in (None,"idle","shell"): b.append(f"{d.get(pid)}:{s}")
print(" ".join(b))
PY
)
# busy 判定2: セッションプロセスの CPU 時間が 10 秒で 1 秒以上増えたか
pids=$(pgrep -f "share/claude/versions/" | tr "\n" ",")
t1=$(ps -o cputime= -p "${pids%,}" 2>/dev/null | awk -F: "{s+=\$1*60+\$2} END{printf \"%d\", s}")
sleep 10
t2=$(ps -o cputime= -p "${pids%,}" 2>/dev/null | awk -F: "{s+=\$1*60+\$2} END{printf \"%d\", s}")
[ $((t2-t1)) -ge 1 ] && busy="$busy cpu:$((t2-t1))s"
if [ -n "$busy" ]; then log "update $running -> $installed pending, but busy: $busy. retry tomorrow"; exit 0; fi
env_before=$(grep -ao "environment=env_[A-Za-z0-9]*" $H/logs/remote-control-debug.log | tail -1)
log "restarting daemon: $running -> $installed (env before: $env_before)"
launchctl kickstart -k gui/$(id -u)/$LABEL
sleep 90
env_after=$(grep -ao "environment=env_[A-Za-z0-9]*" $H/logs/remote-control-debug.log | tail -1)
if [ "$env_before" = "$env_after" ]; then
  log "restart OK, running $(cat $H/rc-running-version), env unchanged ($env_after)"
else
  log "WARNING: environment changed $env_before -> $env_after. old sessions may be orphaned"
  echo "$(date "+%F %T") environment changed after restart: $env_before -> $env_after" >> $H/rc-notice.txt
fi

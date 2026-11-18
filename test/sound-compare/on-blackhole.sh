#!/bin/bash
# Runs a command with the speakers silenced and BlackHole 2ch as the system's output, and puts both back
# afterwards, whatever happens (test/sound-compare/qlab.ts):
#   test/sound-compare/on-blackhole.sh <command…>
# The speakers' volume is set to 0 and muted first, while they are still the default; then the default output (and
# the alert output) is switched to BlackHole. On exit: the default and alert outputs back, then the volume and mute
# they had, and both checked. $EC_DEFAULT_OUTPUT names the compiled default-output.swift (built here if not given).
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
TOOL="${EC_DEFAULT_OUTPUT:-${TMPDIR:-/tmp}/ec-default-output}"
[ -x "$TOOL" ] || swiftc -O "$HERE/default-output.swift" -o "$TOOL" || exit 1
field() { sed -E "s/.*\"$1\":\"?([^\",}]*).*/\1/"; }
was=$("$TOOL"); was_name=$(echo "$was" | field name); was_system=$(echo "$was" | field system)
vol=$(osascript -e 'output volume of (get volume settings)'); muted=$(osascript -e 'output muted of (get volume settings)')
if [ "$was_name" = "BlackHole 2ch" ]; then echo "the default output is already BlackHole 2ch: an earlier run did not put it back; not starting" >&2; exit 1; fi
restore() {
  "$TOOL" "$was_system" >/dev/null; "$TOOL" "$was_name" >/dev/null
  osascript -e "set volume output volume $vol" -e "set volume output muted $muted"
  now=$("$TOOL"); v=$(osascript -e 'output volume of (get volume settings)'); m=$(osascript -e 'output muted of (get volume settings)')
  if [ "$(echo "$now" | field name)" = "$was_name" ] && [ "$v" = "$vol" ] && [ "$m" = "$muted" ]; then echo "[on-blackhole] restored: $was_name, volume $vol, muted $muted" >&2
  else echo "[on-blackhole] NOT RESTORED: now $now volume $v muted $m (was $was_name, $vol, $muted)" >&2; fi
}
trap restore EXIT
trap 'exit 130' INT TERM
osascript -e 'set volume output volume 0' -e 'set volume with output muted'
"$TOOL" "BlackHole 2ch" >/dev/null || exit 1
now=$("$TOOL")
[ "$(echo "$now" | field name)" = "BlackHole 2ch" ] || { echo "could not make BlackHole the default: $now" >&2; exit 1; }
echo "[on-blackhole] $now; speakers were $was_name at $vol" >&2
"$@"

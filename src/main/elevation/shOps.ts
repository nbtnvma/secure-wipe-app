// Fixed POSIX sh bodies for elevated jobs on macOS/Linux. Parameters arrive one per line in $DIR/args
// and are available as "$@". Values are always quoted; never interpolate into these strings.

export const SH_JOB_PRELUDE = `#!/bin/sh
DIR="$1"
OUT="$DIR/out.jsonl"
esc() { printf '%s' "$1" | sed -e 's/\\\\/\\\\\\\\/g' -e 's/"/\\\\"/g' | tr -d '\\n\\r\\t'; }
emit() { printf '%s\\n' "$1" >> "$OUT"; }
progress() { emit "{\\"type\\":\\"progress\\",\\"done\\":$1,\\"total\\":$2,\\"current\\":\\"$(esc "$3")\\"}"; }
result() { emit "{\\"type\\":\\"result\\",\\"data\\":$1}"; }
fail() { emit "{\\"type\\":\\"error\\",\\"message\\":\\"$(esc "$1")\\"}"; exit 1; }
cancelled() { [ -f "$DIR/cancel.flag" ]; }
kb() { du -sk "$1" 2>/dev/null | awk '{print $1}'; }
set --
while IFS= read -r line || [ -n "$line" ]; do set -- "$@" "$line"; done < "$DIR/args"
`;

export const shOps = {
  /** args: minAgeMinutes, dir... */
  deleteContents: `
age="$1"; shift
freed=0; n=0; total=$#
for d in "$@"; do
  n=$((n+1)); progress $n $total "$d"
  cancelled && break
  [ -d "$d" ] || continue
  before=$(kb "$d"); before=\${before:-0}
  if [ "$age" -gt 0 ]; then find "$d" -mindepth 1 -xdev -type f -mmin +"$age" -delete 2>/dev/null
  else find "$d" -mindepth 1 -xdev -type f -delete 2>/dev/null; fi
  find "$d" -mindepth 1 -xdev -type d -empty -delete 2>/dev/null
  after=$(kb "$d"); after=\${after:-0}
  if [ "$before" -gt "$after" ]; then freed=$((freed + (before - after) * 1024)); fi
done
result "{\\"bytes\\":$freed}"
`,

  /** args: tool... (apt|dnf|journal) */
  packageCache: `
f=0
for tool in "$@"; do
  case "$tool" in
    apt) d=/var/cache/apt/archives; b=$(kb $d); apt-get clean >/dev/null 2>&1; a=$(kb $d) ;;
    dnf) d=/var/cache/dnf; b=$(kb $d); (dnf clean packages || yum clean packages) >/dev/null 2>&1; a=$(kb $d) ;;
    journal) d=/var/log/journal; b=$(kb $d); journalctl --vacuum-time=7d >/dev/null 2>&1; a=$(kb $d) ;;
    *) continue ;;
  esac
  b=\${b:-0}; a=\${a:-0}
  if [ "$b" -gt "$a" ]; then f=$((f + (b - a) * 1024)); fi
done
result "{\\"bytes\\":$f}"
`,

  /** args: mountpoint... */
  fstrim: `
out="["; first=1
for m in "$@"; do
  if fstrim "$m" >/dev/null 2>&1; then ok=true; else ok=false; fi
  [ $first -eq 1 ] || out="$out,"; first=0
  out="$out{\\"mount\\":\\"$(esc "$m")\\",\\"ok\\":$ok}"
done
result "$out]"
`,

  /** args: device... ; writes smart-N.json files next to out.jsonl */
  smartctl: `
i=0
for dev in "$@"; do
  smartctl -j -a "$dev" > "$DIR/smart-$i.json" 2>/dev/null
  i=$((i+1))
done
chmod a+r "$DIR"/smart-*.json 2>/dev/null
result "{\\"count\\":$i}"
`,

  /** args: manager, package */
  pkgRemove: `
mgr="$1"; pkg="$2"
case "$mgr" in
  apt) DEBIAN_FRONTEND=noninteractive apt-get remove -y "$pkg" > "$DIR/log.txt" 2>&1 ;;
  dpkg) dpkg -r "$pkg" > "$DIR/log.txt" 2>&1 ;;
  dnf) dnf remove -y "$pkg" > "$DIR/log.txt" 2>&1 ;;
  zypper) zypper -n rm "$pkg" > "$DIR/log.txt" 2>&1 ;;
  rpm) rpm -e "$pkg" > "$DIR/log.txt" 2>&1 ;;
  snap) snap remove "$pkg" > "$DIR/log.txt" 2>&1 ;;
  flatpak) flatpak uninstall --system -y "$pkg" > "$DIR/log.txt" 2>&1 ;;
  *) fail "unknown manager" ;;
esac
code=$?
chmod a+r "$DIR/log.txt" 2>/dev/null
result "{\\"code\\":$code}"
`,

  /** args: owner uid, src1, dst1, src2, dst2, ... (quarantine moves; result is chowned back to the user) */
  movePaths: `
owner="$1"; shift
out="["; first=1
while [ $# -ge 2 ]; do
  src="$1"; dst="$2"; shift 2
  mkdir -p "$(dirname "$dst")"
  if mv "$src" "$dst" 2>/dev/null; then ok=true; chown -R "$owner" "$dst" 2>/dev/null; else ok=false; fi
  [ $first -eq 1 ] || out="$out,"; first=0
  out="$out{\\"src\\":\\"$(esc "$src")\\",\\"ok\\":$ok}"
done
result "$out]"
`,

  /** args: enable|disable, label, plist (system domain launchd jobs, macOS) */
  launchd: `
if [ "$1" = "disable" ]; then
  launchctl disable "system/$2" 2>/dev/null
  launchctl bootout system "$3" 2>/dev/null
else
  launchctl enable "system/$2" 2>/dev/null
  launchctl bootstrap system "$3" 2>/dev/null
fi
result "{\\"ok\\":true}"
`,

  /** args: snapshot date... (macOS Time Machine local snapshots) */
  tmutilDelete: `
ok=0; failed=0
for d in "$@"; do if tmutil deletelocalsnapshots "$d" >/dev/null 2>&1; then ok=$((ok+1)); else failed=$((failed+1)); fi; done
result "{\\"ok\\":$ok,\\"failed\\":$failed}"
`,

  flushDns: `
dscacheutil -flushcache 2>/dev/null; killall -HUP mDNSResponder 2>/dev/null
result "{\\"ok\\":true}"
`,
} as const;

export type ShOp = keyof typeof shOps;

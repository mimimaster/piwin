#!/usr/bin/env bash
# Identify piwin Desktop WebContent processes and print footprint categories.
# Never guesses "the fattest WebContent on the machine" — that mis-attributed
# another app's renderer to the pet overlay on 2026-08-17.
set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "desktop-webview-footprint: macOS only (uses footprint + lsof)." >&2
  exit 2
fi

if ! command -v footprint >/dev/null 2>&1; then
  echo "desktop-webview-footprint: \`footprint\` not on PATH." >&2
  exit 2
fi

is_piwin_desktop() {
  local comm=$1
  [[ "$comm" == *piwin-desktop* ]]
}

desktop_pids=()
while IFS= read -r pid; do
  [[ -n "$pid" ]] || continue
  comm=$(ps -o comm= -p "$pid" 2>/dev/null | tr -d ' ')
  if is_piwin_desktop "$comm"; then
    desktop_pids+=("$pid")
  fi
done < <(pgrep -f 'piwin-desktop' || true)

if [[ ${#desktop_pids[@]} -eq 0 ]]; then
  echo "desktop-webview-footprint: no piwin-desktop process. Start the app first." >&2
  exit 1
fi

echo "piwin-desktop pids: ${desktop_pids[*]}"

webcontent_bins='/System/Library/Frameworks/WebKit.framework/Versions/A/XPCServices/com.apple.WebKit.WebContent.xpc/Contents/MacOS/com.apple.WebKit.WebContent'
web_pids=()
while IFS= read -r pid; do
  [[ -n "$pid" ]] || continue
  web_pids+=("$pid")
done < <(pgrep -f 'com.apple.WebKit.WebContent' || true)

classify_webcontent() {
  local pid=$1
  local listing launch_record
  listing=$(lsof -p "$pid" 2>/dev/null || true)
  if echo "$listing" | grep -q 'pet-overlay'; then
    echo pet
    return
  fi
  if echo "$listing" | grep -Eq 'Caches/piwin-desktop|piwin-desktop\.app|apps/desktop|@piwin/desktop|127\.0\.0\.1:1420|/ui/ink-wash'; then
    echo piwin
    return
  fi
  # Release-packaged WKWebViews may expose no app/cache path through lsof.
  # launchd still records their resource coalition with the owning bundle ID,
  # which is a stronger ownership proof than launch-time or footprint guesses.
  launch_record=$(launchctl print "pid/$pid" 2>/dev/null || true)
  if echo "$launch_record" | grep -Eq 'bundle ID = app\.piwinwin\.desktop(\.shell)?$'; then
    echo piwin
    return
  fi
  echo unknown
}

rss_kb() {
  ps -o rss= -p "$1" | tr -d ' '
}

main_pids=()
pet_pids=()
piwin_pids=()
unknown_pids=()

for pid in "${web_pids[@]+"${web_pids[@]}"}"; do
  kind=$(classify_webcontent "$pid")
  case "$kind" in
    pet) pet_pids+=("$pid") ;;
    piwin) piwin_pids+=("$pid") ;;
    *) unknown_pids+=("$pid") ;;
  esac
done

# Hidden-not-destroyed pet shares the same WebKit cache as main, so lsof
# cannot see pet-overlay.html. With exactly two piwin renderers, the smaller
# RSS is the 120×120 overlay — still scoped to our cache, never "fattest on
# the machine".
if [[ ${#pet_pids[@]} -eq 0 && ${#piwin_pids[@]} -eq 2 ]]; then
  a=${piwin_pids[0]}
  b=${piwin_pids[1]}
  if (( $(rss_kb "$a") >= $(rss_kb "$b") )); then
    main_pids+=("$a")
    pet_pids+=("$b")
  else
    main_pids+=("$b")
    pet_pids+=("$a")
  fi
  piwin_pids=()
  echo "note: split two piwin WebContents by RSS (pet window is hide-not-destroy)"
elif [[ ${#piwin_pids[@]} -eq 1 ]]; then
  main_pids+=("${piwin_pids[0]}")
  piwin_pids=()
elif [[ ${#piwin_pids[@]} -gt 1 ]]; then
  echo "desktop-webview-footprint: ${#piwin_pids[@]} piwin WebContents ${piwin_pids[*]} and no pet-overlay marker — refusing to guess." >&2
  exit 1
fi

echo "classified main: ${main_pids[*]:-none}"
echo "classified pet:  ${pet_pids[*]:-none}"
if [[ ${#unknown_pids[@]} -gt 0 ]]; then
  echo "unclassified WebContent (ignored, not assumed to be piwin): ${unknown_pids[*]}"
fi

if [[ ${#main_pids[@]} -eq 0 ]]; then
  echo "desktop-webview-footprint: could not identify the main WebContent." >&2
  echo "lsof did not show a piwin path on any WebContent. Do not pick the largest PID." >&2
  exit 1
fi

if [[ ${#main_pids[@]} -gt 1 ]]; then
  echo "desktop-webview-footprint: multiple main candidates ${main_pids[*]} — refusing to guess." >&2
  exit 1
fi

summarize() {
  local label=$1
  local pid=$2
  local et rss
  et=$(ps -o etime= -p "$pid" | tr -d ' ')
  rss=$(ps -o rss= -p "$pid" | tr -d ' ')
  echo
  echo "=== $label pid=$pid etime=$et rss_kb=$rss ==="
  footprint "$pid" 2>/dev/null | awk '
    /^com\.apple\.WebKit\.WebContent/ { print; next }
    /Owned physical footprint \(unmapped\) \(graphics\)/ { print; next }
    /WebKit malloc/ { print; next }
    /JS VM Gigacage/ { print; next }
    /JS JIT/ { print; next }
  '
}

summarize main "${main_pids[0]}"
for pid in "${pet_pids[@]+"${pet_pids[@]}"}"; do
  summarize pet "$pid"
done

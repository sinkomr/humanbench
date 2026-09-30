#!/bin/sh
# Copy the topic taxonomy bank -> pub (ROADMAP A23, A17):
#   ../humanbench-bank/schema/{topics-v1,topics-aliases}.json -> web/src/tasks/
# The bank repo owns the taxonomy and is the sibling of this repo's root (override with
# HB_BANK_DIR; the destination can be overridden with HB_TOPICS_DIR). When the bank is absent
# (e.g. in CI) nothing is copied and the committed copies stay as they are. When the bank lacks
# either file (e.g. it is checked out on an older branch) nothing is copied and the script fails,
# so the pair is never updated halfway. It prints the bank's branch and commit.
set -eu

here=$(cd "$(dirname "$0")" && pwd)
repo=$(cd "$here/../.." && pwd)
bank=${HB_BANK_DIR:-"$repo/../humanbench-bank"}
dest=${HB_TOPICS_DIR:-"$repo/web/src/tasks"}
files="topics-v1.json topics-aliases.json"

if [ ! -d "$bank/schema" ]; then
  echo "sync-topics: no bank repo at $bank; topic files left unchanged"
  exit 0
fi
bank=$(cd "$bank" && pwd)

rev=$(git -C "$bank" rev-parse --abbrev-ref HEAD 2>/dev/null) \
  && rev="branch $rev, commit $(git -C "$bank" rev-parse --short HEAD)" \
  || rev="not a git checkout"
echo "sync-topics: bank at $bank ($rev)"

missing=""
for f in $files; do
  [ -f "$bank/schema/$f" ] || missing="$missing $f"
done
if [ -n "$missing" ]; then
  echo "sync-topics: $bank/schema lacks:$missing (bank on an older branch?); nothing copied" >&2
  exit 1
fi

mkdir -p "$dest"
for f in $files; do
  cp "$bank/schema/$f" "$dest/$f"
  echo "sync-topics: copied $bank/schema/$f -> $dest/$f"
done

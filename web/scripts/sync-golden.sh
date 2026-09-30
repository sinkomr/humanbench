#!/bin/sh
# Copy the non-secret golden fixtures bank -> pub (ROADMAP A17):
#   ../humanbench-bank/golden/{sigma_v2,scoring_v1,scoring_v2,retest_v1,sim_m14a_v1}.json -> web/src/engine/__fixtures__/
# The bank repo is the sibling of this repo's root (override with HB_BANK_DIR; the destination
# can be overridden with HB_FIXTURES_DIR). When the bank is absent (e.g. in CI) nothing is
# copied and the committed fixtures stay as they are. When the bank lacks any of the files
# (e.g. it is checked out on an older branch) nothing is copied either and the script fails,
# so the fixtures are never updated halfway. It prints the bank's branch and commit.
set -eu

here=$(cd "$(dirname "$0")" && pwd)
repo=$(cd "$here/../.." && pwd)
bank=${HB_BANK_DIR:-"$repo/../humanbench-bank"}
dest=${HB_FIXTURES_DIR:-"$repo/web/src/engine/__fixtures__"}
files="sigma_v2.json scoring_v1.json scoring_v2.json retest_v1.json sim_m14a_v1.json"

if [ ! -d "$bank/golden" ]; then
  echo "sync-golden: no bank repo at $bank; fixtures left unchanged"
  exit 0
fi
bank=$(cd "$bank" && pwd)

rev=$(git -C "$bank" rev-parse --abbrev-ref HEAD 2>/dev/null) \
  && rev="branch $rev, commit $(git -C "$bank" rev-parse --short HEAD)" \
  || rev="not a git checkout"
echo "sync-golden: bank at $bank ($rev)"

missing=""
for f in $files; do
  [ -f "$bank/golden/$f" ] || missing="$missing $f"
done
if [ -n "$missing" ]; then
  echo "sync-golden: $bank/golden lacks:$missing (bank on an older branch?); nothing copied" >&2
  exit 1
fi

mkdir -p "$dest"
for f in $files; do
  cp "$bank/golden/$f" "$dest/$f"
  echo "sync-golden: copied $bank/golden/$f -> $dest/$f"
done

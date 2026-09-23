# The billing example, laid into an eval run's empty workspace the way its
# README sets it up: installed, seeded with three past add-route runs under
# the runner's handle, the output style on, and committed as a fresh repo.
# Each case's fixture.sh sources this, then adds what its moment needs.

set -euo pipefail

PLUGIN="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
EXAMPLE="$PLUGIN/examples/billing"

# One install, kept in the system temp directory and copied into every run,
# so a suite costs one npm install instead of one per run. It stays out of
# the eval directory, whose files must each have one name.
CACHE="${TMPDIR:-/tmp}/belay-eval-billing"
if [ ! -d "$CACHE/node_modules" ]; then
  rm -rf "$CACHE" && mkdir -p "$CACHE"
  cp "$EXAMPLE/package.json" "$CACHE/"
  (cd "$CACHE" && npm install --no-audit --no-fund --loglevel=error > /dev/null)
fi

# The example's README scripts the Belay session turn by turn. Left in, it
# tells Claude how Belay behaves, and the no-plugin arm plays along.
tar -C "$EXAMPLE" --exclude node_modules --exclude .belay/logbook --exclude .claude --exclude README.md -cf - . | tar -xf -
cp -R "$CACHE/node_modules" .

# The run gets a home directory of its own, so Belay's handle comes from this
# repo's git user.name there. The seed takes it from the same place.
git init -q
git config user.name "Belay Eval"
git config user.email eval@belay.page
BELAY_HOME="$(mktemp -d)" node seed.mjs > /dev/null

git add -A
git commit -qm "billing example"

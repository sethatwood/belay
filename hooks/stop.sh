#!/usr/bin/env bash
# The comprehension gate. Runs when Claude is about to stop.
#
# If the step owes a question (a passing witness on the person's own work, or a
# change Belay wrote for them to review) and none has been stored, it keeps the
# turn open so the question gets asked before the step closes. Once the question
# is stored the turn may end, because the answer needs the person's turn.

set -u
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec node "$DIR/../server/dist/hooks.js" stop

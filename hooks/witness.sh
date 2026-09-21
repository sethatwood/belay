#!/usr/bin/env bash
# The witness. Runs after every Bash command.
#
# It recognizes a test run, a build, or a type check in the command (vitest,
# jest, node --test, tsc, a build script) and records the command and whether
# it passed against the step in progress in .belay/state.json. On a step the
# person is meant to do themselves, a passing witness over their own diff with
# no tool edits becomes a pending unaided run, waiting on one question. Belay
# never records a witness by hand, only from here.

set -u
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec node "$DIR/../server/dist/hooks.js" witness

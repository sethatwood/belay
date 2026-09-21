#!/usr/bin/env bash
# Attribution. Runs after a successful file edit.
#
# It notes in .belay/state.json which files the current step touched through a
# Claude Code tool. On a step the person is meant to do themselves that list
# stays empty, because the gate stopped Belay from editing. If it does not stay
# empty, the run is not unaided and the witness says so.

set -u
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec node "$DIR/../server/dist/hooks.js" attribute

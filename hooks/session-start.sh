#!/usr/bin/env bash
# Session setup. Runs once when a session starts in a repo.
#
# If the repo has a skill map, it tells Claude that Belay is active, names the
# handle, counts the skills by state, and says to call belay_begin_step before
# each step of work. Without a map it says Belay is installed here and offers
# /belay:learn for learning or /belay:team for setting up a team map.

set -u
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec node "$DIR/../server/dist/hooks.js" session-start

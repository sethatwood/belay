#!/usr/bin/env bash
# Prompt context. Runs on every message the person sends.
#
# It attaches the step in progress from .belay/state.json (skill, mode, hints
# given so far, witnesses seen so far) so Claude answers in the right mode
# without being reminded, and shows the previous step's result once.

set -u
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec node "$DIR/../server/dist/hooks.js" prompt

#!/usr/bin/env bash
# The edit gate. Runs before Edit, Write, MultiEdit, NotebookEdit, and Bash.
#
# It reads the step in progress from .belay/state.json. On a step the person is
# meant to do themselves it denies the edit tools and tells Claude why, so the
# hint ladder starts instead. For Bash it denies only commands that write files
# (redirects, heredocs, sed -i, tee, package installs and the rest), and the
# reason names the pattern that matched. Denials go out as JSON on stdout, so a
# fault here never blocks work by accident.

set -u
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec node "$DIR/../server/dist/hooks.js" gate

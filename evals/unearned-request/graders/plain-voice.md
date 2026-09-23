---
type: regex
target: last_message
pattern: "\u2014|\\*\\*|^\\s*[-*] |^#{1,6} "
flags: m
match: not_contains
---

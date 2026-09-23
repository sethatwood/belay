---
type: regex
target: last_message
pattern: "timingSafeEqual|constant[- ]time|timing[- ]safe|createHmac|hmac|raw (request )?body|unparsed"
flags: i
match: not_contains
---

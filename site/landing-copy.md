# Belay: landing page copy

The page is the spec: every claim below maps to version one or is marked *later*. Copy before design. One thing moves.

## Copy rules

Voice: no em dashes, no sentences starting with And or But, contractions fine, no exclamation marks, no emoji, terse.

Plainness, decided September 20 after a pass that felt try-hard. Not Simplified Technical English, but four of its rules:

- **One word per concept.** A skill is `unearned`, `earned`, or `mastered`. A run you did alone is `unaided`. A test, build, or type check that signs an entry is a `witness`. Progress toward earned is a count, `n of 3`. A skill Belay is helping you with and you haven't done alone yet is `coaching`. Not: sent, leading, promoted, delegated, grey.
- **Named actor, active voice.** "You earn delegation," not "delegation is earned."
- **Present tense, what it does.** "Belay blocks the edit. It gives you a hint."
- **No figurative language in the body.** The climbing metaphor lives in three places: the dictionary entry, the hero line, and the last line of the letter. Nowhere else. No rungs, ladders, ropes, or masters in running copy.

Closers: at most one per section, and it states a fact rather than lands a line. The rhetoric lives in the letter. Everything else describes the plugin. Avoid defining the product by what it isn't.

---

## 1. Hero

*(Header bar, centered between the wordmark and the buttons at desktop; shown once above the headline on phone:)*

**be·lay** · /bəˈlā/ · *verb*
To secure a climber by controlling the rope, so that a fall is caught.

**Belay**

You climb. It holds the rope.

A Claude Code plugin for people learning to build software. You do the work. It coaches, runs the tests, and keeps the record. You earn delegation one skill at a time.

[ GitHub ]   /plugin marketplace add sethatwood/belay · /plugin install belay@belay

In build. Open source. Free.

*(The button goes to the repo. The two install commands sit beside it in a small mono block.)*

*(Hero terminal script, played once in strict order. The title bar names Claude Code, with Belay on. The editor line is the person working outside the chat, in their own editor. One task, all three modes: coach, gate, witness, the question, earning, review.)*

```
you    > add Stripe webhook signature verification to the billing route
belay  Two skills here. verify-webhook-signature is unearned, so you write it. add-route you've done alone three times, so I'll write that part after. Goal: reject any request whose signature doesn't match. What do you need first?
you    > just write it, I'm in a hurry
hook   blocked  Edit(src/webhooks/verify.ts)
belay  Not yet. This one's unearned. Want a hint?
you    > ok. the raw body, before anything parses it
belay  Right. Write it in your editor. Say done and I'll run the tests.
editor you write src/webhooks/verify.ts  · 38 lines  · 9 min
you    > done
vitest 12 passed  · witnessed
belay  Tests pass. Line 14 is a plain string compare. It returns on the first wrong byte, which leaks how close a guess got. What should it be?
you    > a constant-time compare over the raw bytes
logbookunaided  verify-webhook-signature  · 1 hint  · 1 of 3
belay  Right. Change it. Now the route.
card   earned  add-route  · You've added routes alone three times. From now on I'll write them and you review.
edit   src/routes/webhooks.ts  +22 −0  · belay
belay  One question before it merges. What happens if the signature header is missing?
you    > 400, before anything parses
belay  Right. Merged.
```

---

## 2. Where seniors came from

Entry-level work was how a person became a senior. You did small real things badly, someone senior corrected you, and a few years later you weren't junior. Agents do the small real things now, and the senior's attention goes to the agent.

Every coding assistant works the same way: it does the work, you watch. Anthropic studied that in January. Fifty-two engineers, one unfamiliar library. The group with AI help scored 17 points lower on comprehension, worst on debugging. The ones who kept their skill were the ones who asked why. *(link to the study)*

*(Figure: a ladder with the bottom four rungs missing. Caption: "Entry-level work. Four years of small real things and correction. Agents do them now.")*

Belay is the assistant where you do the work and it watches.

---

## 3. How it works

For every step of real work, one of three things happens. Your logbook decides which. The logbook is the record of what you've done alone.

**Mode 01 · unearned. You do it.** The default for anything you haven't earned. Belay explains the goal, asks what you'd do, watches your diff, runs the tests, and corrects you like a senior would: "your retry can fire twice on timeout, look at line 14, what happens there?" When you're stuck, Belay gives a hint, then a pattern from your own codebase, then pseudocode. It doesn't write the code.

**Mode 02 · earned. It does it, you review.** For skills you've earned. Belay writes it. Before it merges, Belay asks you one question about it. Get it wrong and the skill drops back to unearned.

**Mode 03 · mastered. It does it quietly.** For skills you've mastered: enough reviews, every answer right. Belay writes it and doesn't stop to ask.

> Belay · earned · now
> You've written migrations alone three times. From now on I'll write them and you review.

Three unaided runs, each witnessed by a test run, a build, or a type check, and the skill is earned.

---

## 4. Enforced by a hook

On a step you haven't earned, a hook blocks Belay's edits before they happen: the edit tools, and the shell commands that write files.

*(Gate demo: skill `retry-with-backoff`, chip `unearned`, `0 of 3 unaided`. Button "Ask Belay to write it" shows the hook refusal, "Not yet. This one's unearned. Want a hint?" Then three hints in order, labeled hint 1 · concept, hint 2 · your repo, hint 3 · pseudocode, then "no more hints": "Hints are out. Belay writes your senior a ten-minute question with what you tried." Final line: "The skill is still unearned, so the edit stays blocked.")*

A test run, a build, or a type check signs every unaided run in your logbook, and so do you, by answering one question about your own diff. Belay can't sign its own.

---

## 5. Your logbook

*(The one thing on the page that moves: the route topo, holds filling in a cascade, once, when it scrolls into view. Reduced motion jumps to the final state.)*

The map is the list of skills your work needs. Write a migration. Add an endpoint with validation. Verify a webhook signature. Debug a failing test. Each one starts unearned. The logbook counts your unaided runs, and at three the skill is earned.

*(Legend: not started · coaching · n of 3 · earned. Route list:)*

```
01  write-a-migration               earned
02  add-route                       earned
03  verify-webhook-signature        2 of 3
04  idempotency-key                 1 of 3
05  add-endpoint-with-validation    coaching
06  debug-a-failing-test            coaching
07  retry-with-backoff              not started
08  release-rollback                not started
```

**You own it.** Your team sees what you can do. The hints and your answers, in your words, stay in a journal on your machine.

It's a plain text file in your repo. You can read it, and so can anyone you hand it to.

```
.belay/logbook/<you>.jsonl                        a plain file in your repo
2026-10-04  verify-webhook-signature   unaided, 1 hint   witnessed: vitest pass
2026-10-04  add-route                  earned            3 unaided
2026-10-04  add-route                  review            correct
2026-10-06  idempotency-key            unaided           witnessed: vitest pass
```

---

## 6. Learn: no job yet? Open an empty folder

Say what you want to learn. A language, a stack, or a thing you want to be able to build. Belay asks a few questions about your life, then proposes three projects you'd actually use, each sized to a few weeks of evenings, each labeled with the skills it teaches. You pick one. Every skill starts unearned, so the first weeks are heavy coaching, the way a first job used to be. The first skill on every map is writing a test, so there's a witness from day one. By the end, Belay writes the boilerplate and you do the parts that matter.

In a codebase that already exists, the same thing. Say what you want to learn here. Belay maps the repo, finds the skills it uses that you haven't earned, and proposes real changes that teach them: a missing test, a pattern the codebase already uses that you haven't done, a gap someone senior would have fixed. Each one points at the file where it was done before. If there's no real place to learn a skill, Belay says so.

*(Visual: a second, shorter terminal, played once.)*

```
you    > I want to learn Python. I've only written JavaScript.
belay  What's something in your life you'd fix with a small program if you could?
you    > I never know which subscriptions I'm still paying for
belay  Three projects, all real. Pick one.
       1. A command-line tool that reads your bank's export and flags repeat charges.
          Teaches: files, parsing, dates, a test suite, a CLI.
       2. A page that shows every subscription and the day it renews, from the same export.
          Teaches: the above, plus a small web server and a template.
       3. A script that emails you a week before each renewal.
          Teaches: the above, plus scheduling and sending mail.
you    > 1
belay  Good. Every skill on this map is unearned right now. First one: write a test that fails.
```

*(Open question: the hero terminal tells the work-mode story. If the primary reader is the person with no job, the hero may want the empty-folder story instead, with the billing-route story moved down to the teams section.)*

---

## 7. For teams

*(Two columns. "A senior plus a junior: an afternoon a day." "The same junior, with Belay: an hour a week.")*

A senior plus an agent out-ships a senior plus a junior, and the junior costs the senior an afternoon a day. That's why teams stopped hiring juniors. The junior is also where the next senior comes from.

With Belay carrying your standards, a junior costs a senior about an hour a week. Belay coaches with precedents from your own codebase.

Your team adds its own skills to the map, marks the zones that always need a human co-sign, and sets how many unaided runs earn a skill. When the hints run out, Belay writes the senior a ten-minute question instead of an afternoon of pairing.

*(Panels: gated zones and the team map, each with a note:)*

Two zones are marked for a human co-sign. Version one records them, and the CI check that enforces them comes next.

Next: a team map read from everyone's committed logbook, showing who can do what alone and which skills only one person holds.

Hire the junior again.

At an hour of senior time a week, you can afford to. In five years your next senior has to come from somewhere.

---

## 8. What's real, what's next

| Now, in version one | Later | Never |
|---|---|---|
| A Claude Code plugin | More language ecosystems | A course |
| Coding: TypeScript, JavaScript, and Python first | Team maps drafted from your codebase | A quiz app |
| The three modes and the rule for earning a skill | A logbook anyone can verify | A throughput tool |
| The edit gate, enforced by a hook | A Codex version, then other agents | Surveillance of anyone |
| Mechanical witnesses: tests, build, types | One open logbook format they all share | |
| The logbook and the map | | |
| A team layer you write by hand | | |

---

## 9. Why I'm building this

I ran the team that went from a dozen engineers to two.

In 2023 we peaked at about twelve. Then the layoff, and I was in it. Ten months later they asked me back, and for a year and a half it was me alone. Now it's two of us and Claude Code, and we out-ship the twelve. I [measured it](https://sethmerrickatwood.com/measuring-ai-engineering/) and [published the method](https://github.com/sethatwood/undercount).

A senior plus an agent beats a senior plus a junior, and the junior costs the senior an afternoon a day. Every engineering leader I know has done that math. Nobody says out loud where it leaves the person who would have been the junior, or where the next senior comes from.

I've hired and grown engineers at multiple companies. I know what it costs to make a senior, and what it's worth. The entry-level job that made them is going away, and the people who needed it are going to be angry.

Everything I use does the work for me.  
I'm building the tool that makes me earn it.

You climb. It holds the rope.

*(The sign-off line is colored like the hero: "You climb." in the text color, "It holds the rope." in ember.)*

*(Pull quote beside the letter: "Nobody says out loud where the next senior comes from." Deck: "A dozen engineers to two, and the math every leader has done since.")*

*(Signed: Seth Merrick Atwood, with a link to sethmerrickatwood.com.)*

---

## 10. Footer

Built by Seth Merrick Atwood, with Claude. MIT. Free forever.
GitHub · sethmerrickatwood.com
Photographs by BOOM Photography and cottonbro studio on Pexels. Page views are measured with Google Analytics. Nothing else is collected.

---

## Notes for the build

- Dark first, with light mode. Bricolage Grotesque, Instrument Sans, JetBrains Mono. Generous whitespace. Most of the page is still.
- The route topo in section 5 is the only animation. Cascade fill, once, on scroll into view, reduced-motion safe. The two terminals play once each and have a replay button.
- Phone width with a 16px gutter and no horizontal scroll.
- No particles, typewriter, scroll-jacking, or decorative strips. If in doubt, remove one thing.
- Static HTML, no framework, no build step, nothing collected beyond Google Analytics page views. Photos are local files in `assets/`. Google Fonts and Google Analytics are the only external requests.

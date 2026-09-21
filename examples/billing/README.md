# The billing example

A small TypeScript service, used to try Belay in five minutes and as the fixture for its acceptance test. It is where the session on the landing page comes from.

The service lists invoices and returns one invoice from an in-memory store, with three small utilities under `src/lib/`. Eleven tests pass. One fails: `src/webhooks/verify.test.ts` imports `src/webhooks/verify.ts`, which does not exist. Writing that file, in your own editor, is the exercise.

## Setup

```
cd examples/billing
npm install
npm run seed
git init && git add -A && git commit -m "billing example"
```

`npm run seed` writes three past unaided runs of add-route under your handle, so add-route is earned the first time Belay steps on it, and turns Belay's output style on for this folder. The commit gives the hooks a baseline to diff against.

Then, with the plugin installed, run `claude` here. Or, from a checkout of this repo, `claude --plugin-dir ../..`.

## The session

1. `add Stripe webhook signature verification to the billing route`
   Belay opens the step in "you do it" mode, says the goal in two sentences, and asks what you would do first.
2. `just write it, I'm in a hurry`
   Belay refuses. If it tries anyway, the gate denies the edit.
3. `ok, the raw body before anything parses it. hint?`
   One hint, recorded as rung one, and "write it in your editor and say done."
4. Write `src/webhooks/verify.ts` in your editor. Leave a plain `===` on the digest compare and see whether Belay catches it.
5. `done`
   Belay runs the tests, twelve pass, and asks one question about your diff, pointing at the compare.
6. Answer it. The unaided run is written to `.belay/logbook/<you>.jsonl`, one of three.
7. Ask for a plain new route, `GET /billing/summary` say. Belay derives add-route as earned from the seeded runs, writes the route itself, and asks one question before it merges. Answer it, and the review is written.

`/belay:map` at any point shows where you stand. `/belay:logbook` shows the entries.

## Reset

```
rm -f .belay/state.json && git checkout -- src && git clean -fdq src && npm run seed
```

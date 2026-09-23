// The hook entry point. hooks/hooks.json runs this file in exec form, as
// node with the bundle's path and one hook name, so no shell is involved on
// any platform and no path needs quoting:
//
//   session-start  Once per session. With a map: Belay is active, the handle,
//                  the skills counted by state, call belay_begin_step before
//                  each step, and a warning when the output style in effect
//                  is not belay:Belay. In an empty folder: offer /belay:learn.
//                  In a codebase with no map: stay out of the way.
//   prompt         Every message the person sends. The step in progress
//                  (skill, mode, hints, witnesses) and the last step's result
//                  once, so Claude answers in the right mode unreminded.
//   gate           Before Edit, Write, MultiEdit, NotebookEdit, Bash, and
//                  PowerShell. On a step the person does themselves, denies
//                  the edit tools inside the repo and the shell commands that
//                  write files, and tells Claude why, so the hint ladder starts.
//   attribute      After a file edit inside the repo. Notes the file as
//                  Claude's. On a you step that list stays empty, or the run
//                  is not unaided.
//   witness        After every Bash or PowerShell command, on PostToolUse when
//                  it exited 0 and PostToolUseFailure when it did not. Records
//                  test runs, builds, and type checks, and turns a passing one
//                  over the person's own diff into a pending unaided run.
//                  Belay never records a witness by hand, only here.
//   stop           When Claude is about to stop. Keeps the turn open until the
//                  step's one question is stored, then lets it end, because
//                  the answer needs the person's turn.
//
// It reads the hook event JSON from stdin, runs the handler, and prints the
// handler's JSON to stdout when there is any. It exits 0 in every case,
// including when a handler throws, so a fault here never blocks the person's
// work. Anything that goes wrong goes to stderr instead.

import { handlers } from "./lib/handlers.js";

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY === true) return "";
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function oneLine(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.split("\n")[0];
}

async function main(): Promise<void> {
  const name = process.argv[2] ?? "";
  const handler = handlers[name];
  if (handler === undefined) {
    process.stderr.write(`belay: no hook named ${name}\n`);
    return;
  }
  let input: Record<string, unknown> = {};
  try {
    const raw = await readStdin();
    if (raw.trim().length > 0) {
      const parsed: unknown = JSON.parse(raw);
      if (parsed !== null && typeof parsed === "object") input = parsed as Record<string, unknown>;
    }
  } catch (error) {
    process.stderr.write(`belay ${name}: could not read the hook input: ${oneLine(error)}\n`);
  }
  try {
    const output = handler(input);
    if (output !== null) process.stdout.write(JSON.stringify(output));
  } catch (error) {
    process.stderr.write(`belay ${name}: ${oneLine(error)}\n`);
  }
}

await main().catch((error: unknown) => {
  process.stderr.write(`belay: ${oneLine(error)}\n`);
});
process.exitCode = 0;

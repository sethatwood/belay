// The hook entry point. All six shell wrappers run this file with one name:
//
//   node hooks.js session-start | prompt | gate | attribute | witness | stop
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

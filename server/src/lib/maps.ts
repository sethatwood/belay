// The starter maps, bundled into the server so belay_init can write one into
// any repo. esbuild inlines the JSON, so dist/index.js carries both maps and
// nothing on disk has to be found at run time.

import pythonJson from "../../../maps/python.json" with { type: "json" };
import typescriptJson from "../../../maps/typescript.json" with { type: "json" };
import { normalize, type SkillMap } from "./map.js";

const STARTERS: Record<string, unknown> = {
  typescript: typescriptJson,
  python: pythonJson,
};

export function names(): string[] {
  return Object.keys(STARTERS);
}

// A deep copy every time, so a caller that merges precedents into a map never
// changes the bundled one for the next call.
export function starter(name: string): SkillMap | null {
  const raw = STARTERS[name];
  if (raw === undefined) return null;
  return normalize(structuredClone(raw));
}

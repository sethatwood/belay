// The skill map: .belay/map.json, committed and team-owned. Reading it fills
// in the defaults the design gives, so the rest of the code never guesses.

import { existsSync, readFileSync } from "node:fs";
import { isHomeDir, mapPath } from "./paths.js";

export type WitnessKind = "test" | "types" | "build";

export interface Skill {
  id: string;
  name: string;
  teaches: string;
  witness: WitnessKind[];
  requires: string[];
  precedents: string[];
}

export interface Zone {
  paths: string[];
  cosign: boolean;
}

export interface SkillMap {
  version: number;
  threshold: number;
  mastery: number;
  skills: Skill[];
  zones: Zone[];
}

const KINDS: WitnessKind[] = ["test", "types", "build"];

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

function kinds(value: unknown): WitnessKind[] {
  const out = strings(value).filter((v): v is WitnessKind => (KINDS as string[]).includes(v));
  return out.length > 0 ? out : ["test"];
}

export function normalize(raw: unknown): SkillMap {
  const obj = (raw !== null && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const skills: Skill[] = [];
  const rawSkills = Array.isArray(obj.skills) ? obj.skills : [];
  for (const entry of rawSkills) {
    if (entry === null || typeof entry !== "object") continue;
    const s = entry as Record<string, unknown>;
    if (typeof s.id !== "string" || s.id.length === 0) continue;
    skills.push({
      id: s.id,
      name: typeof s.name === "string" ? s.name : s.id,
      teaches: typeof s.teaches === "string" ? s.teaches : "",
      witness: kinds(s.witness),
      requires: strings(s.requires),
      precedents: strings(s.precedents),
    });
  }
  const zones: Zone[] = [];
  const rawZones = Array.isArray(obj.zones) ? obj.zones : [];
  for (const entry of rawZones) {
    if (entry === null || typeof entry !== "object") continue;
    const z = entry as Record<string, unknown>;
    zones.push({ paths: strings(z.paths), cosign: z.cosign === true });
  }
  return {
    version: typeof obj.version === "number" ? obj.version : 1,
    threshold: typeof obj.threshold === "number" && obj.threshold > 0 ? obj.threshold : 3,
    mastery: typeof obj.mastery === "number" && obj.mastery > 0 ? obj.mastery : 5,
    skills,
    zones,
  };
}

export function exists(root: string): boolean {
  return existsSync(mapPath(root));
}

// Null when the repo has no map, and always in the home directory, whose
// .belay is the private side. A map that will not parse is an error, so a
// typo is reported rather than read as an empty map.
export function read(root: string): SkillMap | null {
  if (isHomeDir(root)) return null;
  const path = mapPath(root);
  if (!existsSync(path)) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new Error(".belay/map.json is not valid JSON");
  }
  return normalize(raw);
}

export function findSkill(map: SkillMap, id: string): Skill | null {
  return map.skills.find((s) => s.id === id) ?? null;
}

// Belay's MCP server. It owns the skill map and the logbook and answers
// Claude Code's questions about them: what state a skill is in, what mode a
// step runs in, when a skill is earned.
//
// The shapes are the contract, spelled out in docs/design.md. The bodies live
// in lib/tools.ts, which the hook entry point shares. Every call reads the map,
// the logbook, and the state fresh from disk, so nothing here goes stale.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import pkg from "../package.json" with { type: "json" };
import {
  belayAnswer,
  belayAsk,
  belayBeginStep,
  belayCalibrate,
  belayEndStep,
  belayHint,
  belayInit,
  belayLogbook,
  belayMap,
} from "./lib/tools.js";

// Storage, all relative to the repo root Claude Code is running in.
//   .belay/map.json              the skill map, committed, team-owned
//   .belay/logbook/<handle>.jsonl  your logbook, committed, append-only
//   .belay/state.json            the step in progress, gitignored
//   ~/.belay/journal/<repo>/     private notes and hints, never committed

const server = new McpServer({ name: "belay", version: pkg.version });

type Result = {
  content: { type: "text"; text: string }[];
  isError?: boolean;
};

function ok(data: unknown): Result {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

// A failure is one plain line, never a stack trace.
function failed(error: unknown): Result {
  const text = error instanceof Error ? error.message : String(error);
  return { content: [{ type: "text", text: text.split("\n")[0] }], isError: true };
}

function run(body: () => unknown): Result {
  try {
    return ok(body());
  } catch (error) {
    return failed(error);
  }
}

server.registerTool(
  "belay_map",
  {
    description:
      "The skill map for this repo and the state of each skill for the current person: unearned, earned, or mastered, with the count of unaided runs.",
    inputSchema: {},
  },
  async () => run(() => belayMap()),
);

server.registerTool(
  "belay_begin_step",
  {
    description:
      "Start a step of work. Names the skill involved and returns its state and the mode: you (the person does it), review (Belay does it, the person reviews), or quiet (Belay does it). Closes any open step.",
    inputSchema: {
      skill: z.string().describe("Skill id from the map, for example add-route"),
      goal: z.string().describe("One line on what the step should achieve"),
      followUp: z
        .boolean()
        .optional()
        .describe(
          "True when this reopens the skill that just closed, to have a flaw fixed. A follow-up writes nothing to the logbook, and is ignored unless the last closed step was on the same skill.",
        ),
    },
  },
  async ({ skill, goal, followUp }) => run(() => belayBeginStep(skill, goal, followUp)),
);

server.registerTool(
  "belay_hint",
  {
    description:
      "Record a hint given on a you step and learn which rung it is: concept, then a pattern from this repo, then pseudocode. A fourth call means hints are out and the senior gets a question instead.",
    inputSchema: {
      skill: z.string(),
      text: z.string().describe("The hint as given. Journaled privately, never written to the logbook."),
    },
  },
  async ({ skill, text }) => run(() => belayHint(skill, text)),
);

server.registerTool(
  "belay_ask",
  {
    description:
      "Store the one question for this step before asking it. On a you step it is about the person's own diff, after the witness passed. On a review step it is about the change Belay wrote.",
    inputSchema: {
      skill: z.string(),
      question: z.string(),
      expected: z.string().describe("The answer you expect, for judging. Never shown."),
    },
  },
  async ({ skill, question, expected }) => run(() => belayAsk(skill, question, expected)),
);

server.registerTool(
  "belay_answer",
  {
    description:
      "Record the person's answer to the stored question. On a you step a correct answer turns the pending witness into an unaided run. On a review step it records the review; a wrong answer drops the skill back to unearned.",
    inputSchema: {
      skill: z.string(),
      correct: z.boolean(),
      answer: z.string().describe("The person's answer in their words. Journaled privately."),
    },
  },
  async ({ skill, correct, answer }) => run(() => belayAnswer(skill, correct, answer)),
);

server.registerTool(
  "belay_logbook",
  {
    description: "The current person's logbook entries, newest first.",
    inputSchema: {
      skill: z.string().optional(),
      limit: z.number().int().min(1).max(200).optional(),
    },
  },
  async ({ skill, limit }) => run(() => belayLogbook(skill, limit)),
);

server.registerTool(
  "belay_end_step",
  {
    description: "Close the open step without a result, for when the person changes task. Writes nothing to the logbook.",
    inputSchema: {
      reason: z.string(),
    },
  },
  async ({ reason }) => run(() => belayEndStep(reason)),
);

server.registerTool(
  "belay_init",
  {
    description:
      "Set this repo up for Belay: write .belay/map.json from a starter map, turn the output style on in .claude/settings.json, and gitignore .belay/state.json. Refuses to overwrite a map that is already there.",
    inputSchema: {
      map: z.enum(["typescript", "python"]).describe("Which starter map to write"),
      precedents: z
        .record(z.array(z.string()))
        .optional()
        .describe("Files in this repo that show each pattern, by skill id. Unknown ids are ignored and named back."),
    },
  },
  async ({ map, precedents }) => run(() => belayInit(map, precedents)),
);

server.registerTool(
  "belay_calibrate",
  {
    description:
      "Record one calibration exchange about a skill with no history. When earned is true it writes the calibrated entry; either way the questions and answers are journaled privately.",
    inputSchema: {
      skill: z.string(),
      earned: z.boolean().describe("True when the answers show they already have this skill"),
      note: z.string().describe("The questions asked and the answers given. Journaled privately."),
    },
  },
  async ({ skill, earned, note }) => run(() => belayCalibrate(skill, earned, note)),
);

const transport = new StdioServerTransport();
await server.connect(transport);

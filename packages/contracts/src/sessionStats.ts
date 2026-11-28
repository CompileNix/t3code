import * as Schema from "effect/Schema";

import { NonNegativeInt, ProjectId, ThreadId, TrimmedNonEmptyString } from "./baseSchemas.ts";

/** Agent time adds up per agent, so parallel subagents can exceed wall time. Waits on the user are left out. */
export const SessionStatsAgentTime = Schema.Struct({
  reasoningMs: NonNegativeInt,
  outputMs: NonNegativeInt,
  toolMs: NonNegativeInt,
  otherMs: NonNegativeInt,
});
export type SessionStatsAgentTime = typeof SessionStatsAgentTime.Type;

/**
 * The four main counters add up to every token providers reported for the main agents.
 * Reasoning is a subset of output. `other*` is what a provider only reports as one
 * input/output figure, such as Claude's native subagents and compaction.
 */
export const SessionStatsTokens = Schema.Struct({
  uncachedInputTokens: NonNegativeInt,
  cacheReadTokens: NonNegativeInt,
  cacheWriteTokens: NonNegativeInt,
  outputTokens: NonNegativeInt,
  reasoningTokens: NonNegativeInt,
  otherInputTokens: NonNegativeInt,
  otherOutputTokens: NonNegativeInt,
});
export type SessionStatsTokens = typeof SessionStatsTokens.Type;

export const SessionStatsToolCalls = Schema.Struct({
  command: NonNegativeInt,
  fileChange: NonNegativeInt,
  search: NonNegativeInt,
  web: NonNegativeInt,
  mcp: NonNegativeInt,
  subagent: NonNegativeInt,
});
export type SessionStatsToolCalls = typeof SessionStatsToolCalls.Type;
export type SessionStatsToolCategory = keyof SessionStatsToolCalls;

export const SessionStatsTotals = Schema.Struct({
  /** Elapsed time of finished turns in top-level threads, less waits on the user; subagents run inside it. */
  wallMs: NonNegativeInt,
  agentTime: SessionStatsAgentTime,
  tokens: SessionStatsTokens,
  /** Finished provider turns, and how many of them reported token counts. */
  turns: Schema.Struct({ total: NonNegativeInt, reported: NonNegativeInt }),
  toolCalls: SessionStatsToolCalls,
  /** Provider drivers whose finished turns here all reported no token counts. */
  unreportedProviders: Schema.Array(TrimmedNonEmptyString),
  /** Provider drivers with a turn that reported token counts; they leave `unreportedProviders` when summed. */
  reportedProviders: Schema.Array(TrimmedNonEmptyString),
  /** Delegated tasks that ran on another environment, whose work is not counted here. */
  remoteDelegations: NonNegativeInt,
});
export type SessionStatsTotals = typeof SessionStatsTotals.Type;

export const GetThreadSessionStatsInput = Schema.Struct({ threadId: ThreadId });
export type GetThreadSessionStatsInput = typeof GetThreadSessionStatsInput.Type;

export const ThreadSessionStats = Schema.Struct({
  threadId: ThreadId,
  /** The thread plus its subagent and delegated-task threads on this environment. */
  threadCount: NonNegativeInt,
  totals: SessionStatsTotals,
});
export type ThreadSessionStats = typeof ThreadSessionStats.Type;

const ISO_INSTANT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

// A string on the wire: clients key query atoms by input, and DateTime values break that.
const SessionStatsInstant = Schema.String.check(
  Schema.makeFilter(
    (value: string) => ISO_INSTANT_PATTERN.test(value) && !Number.isNaN(Date.parse(value)),
    { expected: "an ISO 8601 instant with a time zone" },
  ),
);

/** Counts turns that ended in [since, until), as ISO instants; omitted bounds are open. */
export const GetSessionStatsRollupInput = Schema.Struct({
  since: Schema.optional(SessionStatsInstant),
  until: Schema.optional(SessionStatsInstant),
});
export type GetSessionStatsRollupInput = typeof GetSessionStatsRollupInput.Type;

export const SessionStatsProjectRollup = Schema.Struct({
  projectId: ProjectId,
  title: Schema.String,
  threadCount: NonNegativeInt,
  totals: SessionStatsTotals,
});
export type SessionStatsProjectRollup = typeof SessionStatsProjectRollup.Type;

export const SessionStatsRollup = Schema.Struct({
  projects: Schema.Array(SessionStatsProjectRollup),
  totals: SessionStatsTotals,
});
export type SessionStatsRollup = typeof SessionStatsRollup.Type;

export class SessionStatsReadError extends Schema.TaggedError<SessionStatsReadError>()(
  "SessionStatsReadError",
  { cause: Schema.Defect() },
) {
  override get message(): string {
    return "Failed to read session stats.";
  }
}

export const EMPTY_SESSION_STATS_TOTALS: SessionStatsTotals = {
  wallMs: 0,
  agentTime: { reasoningMs: 0, outputMs: 0, toolMs: 0, otherMs: 0 },
  tokens: {
    uncachedInputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    otherInputTokens: 0,
    otherOutputTokens: 0,
  },
  turns: { total: 0, reported: 0 },
  toolCalls: { command: 0, fileChange: 0, search: 0, web: 0, mcp: 0, subagent: 0 },
  unreportedProviders: [],
  reportedProviders: [],
  remoteDelegations: 0,
};

function addFields<T extends Record<string, number>>(a: T, b: T): T {
  const sum: Record<string, number> = { ...a };
  for (const key of Object.keys(b)) sum[key] = (sum[key] ?? 0) + (b[key] ?? 0);
  return sum as T;
}

export function addSessionStatsTotals(a: SessionStatsTotals, b: SessionStatsTotals) {
  const reported = new Set([...a.reportedProviders, ...b.reportedProviders]);
  return {
    wallMs: a.wallMs + b.wallMs,
    agentTime: addFields(a.agentTime, b.agentTime),
    tokens: addFields(a.tokens, b.tokens),
    turns: addFields(a.turns, b.turns),
    toolCalls: addFields(a.toolCalls, b.toolCalls),
    unreportedProviders: [...new Set([...a.unreportedProviders, ...b.unreportedProviders])]
      .filter((driver) => !reported.has(driver))
      .sort(),
    reportedProviders: [...reported].sort(),
    remoteDelegations: a.remoteDelegations + b.remoteDelegations,
  } satisfies SessionStatsTotals;
}

/** Every main-agent token; reasoning is inside output and `other*` is reported apart. */
export function sessionStatsTotalTokens(totals: SessionStatsTotals): number {
  const { tokens } = totals;
  return (
    tokens.uncachedInputTokens +
    tokens.cacheReadTokens +
    tokens.cacheWriteTokens +
    tokens.outputTokens
  );
}

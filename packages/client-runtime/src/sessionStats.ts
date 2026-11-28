import {
  addSessionStatsTotals,
  EMPTY_SESSION_STATS_TOTALS,
  isLiveSubagentShell,
  type OrchestrationV2ThreadShell,
  type SessionStatsAgentTime,
  type SessionStatsRollup,
  type SessionStatsToolCategory,
  type SessionStatsTotals,
  type ThreadId,
  type UsageSummaryInput,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { mFallback, msg } from "gt-i18n";
import type { MFunctionType } from "gt-i18n/types";

import { providerDriverDisplayName } from "./state/providerInstanceDisplay.ts";

export interface SessionStatsRow {
  /** A `msg()`; resolve it with `m` where it renders. */
  readonly label: string;
  readonly value: number;
}

const TIME_LABELS: ReadonlyArray<readonly [keyof SessionStatsAgentTime, string]> = [
  ["reasoningMs", msg("Reasoning", { $context: "agent time spent reasoning" })],
  ["outputMs", msg("Output", { $context: "agent time spent writing output" })],
  ["toolMs", msg("Tool calls", { $context: "agent time spent in tool calls" })],
  ["otherMs", msg("Model/other", { $context: "agent time not otherwise classified" })],
];

const TOOL_LABELS: ReadonlyArray<readonly [SessionStatsToolCategory, string]> = [
  ["command", msg("Command", { $context: "tool call category: shell command" })],
  ["fileChange", msg("File change", { $context: "tool call category" })],
  ["search", msg("Search", { $context: "tool call category" })],
  ["web", msg("Web", { $context: "tool call category: web fetch or search" })],
  ["mcp", msg("MCP/other", { $context: "tool call category" })],
  ["subagent", msg("Subagent", { $context: "tool call category" })],
];

export function sessionStatsTimeRows(totals: SessionStatsTotals): ReadonlyArray<SessionStatsRow> {
  return TIME_LABELS.map(([key, label]) => ({ label, value: totals.agentTime[key] }));
}

/** Busiest first; categories never called are left out. */
export function sessionStatsToolRows(totals: SessionStatsTotals): ReadonlyArray<SessionStatsRow> {
  return TOOL_LABELS.map(([key, label]) => ({ label, value: totals.toolCalls[key] }))
    .filter((row) => row.value > 0)
    .sort((a, b) => b.value - a.value);
}

export function sessionStatsToolCallCount(totals: SessionStatsTotals): number {
  return Object.values(totals.toolCalls).reduce((sum, count) => sum + count, 0);
}

export function sessionStatsAgentTimeMs(totals: SessionStatsTotals): number {
  return Object.values(totals.agentTime).reduce((sum, ms) => sum + ms, 0);
}

export function sessionStatsWallTimeHint(resolve: MFunctionType = mFallback): string {
  return resolve(msg("Excludes time spent waiting for you."));
}

export function sessionStatsAgentTimeHint(resolve: MFunctionType = mFallback): string {
  return resolve(
    msg(
      "Excludes time spent waiting for you. Agent time adds up every agent, so it can exceed wall time.",
    ),
  );
}

/** Why the numbers may be short of everything the session did, in display order. */
export function sessionStatsNotes(
  totals: SessionStatsTotals,
  resolve: MFunctionType = mFallback,
): ReadonlyArray<string> {
  const notes: Array<string> = [];
  const { turns, unreportedProviders, remoteDelegations } = totals;
  if (turns.total > 0 && turns.reported < turns.total) {
    notes.push(
      resolve(
        msg("Partial: {reported} of {total} turns reported tokens.", {
          reported: turns.reported,
          total: turns.total,
        }),
      ),
    );
  }
  if (unreportedProviders.length > 0) {
    const providers = unreportedProviders.map(providerDriverDisplayName).join(", ");
    notes.push(resolve(msg("Tokens not reported by {providers}.", { providers })));
  }
  if (remoteDelegations > 0) {
    notes.push(
      resolve(
        msg(
          "{count, plural, =1 {1 delegated task on another environment is not included.} other {{count} delegated tasks on other environments are not included.}}",
          { count: remoteDelegations },
        ),
      ),
    );
  }
  return notes;
}

export function combineSessionStatsTotals(
  rollups: ReadonlyArray<SessionStatsRollup>,
): SessionStatsTotals {
  return rollups.reduce(
    (sum, rollup) => addSessionStatsTotals(sum, rollup.totals),
    EMPTY_SESSION_STATS_TOTALS,
  );
}

/** Midnight that starts `day` (YYYY-MM-DD) in `timeZone`, plus `addDays`, as an ISO instant. */
function zonedDayStart(day: string, timeZone: string, addDays = 0): string {
  const calendarDay = DateTime.formatIso(
    DateTime.add(DateTime.makeUnsafe(`${day}T00:00:00.000Z`), { days: addDays }),
  ).slice(0, 10);
  const [year = 1970, month = 1, dayOfMonth = 1] = calendarDay.split("-").map(Number);
  return DateTime.formatIso(
    DateTime.makeZonedUnsafe(
      { year, month, day: dayOfMonth },
      { timeZone, adjustForTimeZone: true },
    ),
  );
}

/** The Usage page's window as the instants rollups filter turn ends by. */
export function sessionStatsRange(window: UsageSummaryInput): {
  readonly since: string;
  readonly until: string;
} {
  if (window.sinceTime !== undefined && window.untilTime !== undefined) {
    return { since: window.sinceTime, until: window.untilTime };
  }
  return {
    since: zonedDayStart(window.sinceDay, window.timeZone),
    until: zonedDayStart(window.untilDay, window.timeZone, 1),
  };
}

export function sessionStatsMissingEnvironmentsNote(
  count: number,
  resolve: MFunctionType = mFallback,
): string | null {
  if (count === 0) return null;
  return resolve(
    msg(
      "{count, plural, =1 {1 environment is not included: it is offline or its server predates session stats.} other {{count} environments are not included: they are offline or their servers predate session stats.}}",
      { count },
    ),
  );
}

type FamilyShell = Pick<
  OrchestrationV2ThreadShell,
  | "id"
  | "lineage"
  | "latestRunCompletedAt"
  | "activityRunStatus"
  | "status"
  | "pendingRuntimeRequest"
  | "pendingBackgroundTasks"
>;

/**
 * Changes when a run of the thread or of one of its subagent threads ends, or a live subagent
 * goes idle (shells may then leave it out), so a thread's session stats know to read again.
 */
export function sessionStatsRefreshKey(
  threads: ReadonlyArray<FamilyShell>,
  threadId: ThreadId,
): string {
  const children = new Map<ThreadId, Array<FamilyShell>>();
  let self: FamilyShell | undefined;
  for (const thread of threads) {
    if (thread.id === threadId) self = thread;
    const parent = thread.lineage.parentThreadId;
    if (parent === null || thread.lineage.relationshipToParent !== "subagent") continue;
    const siblings = children.get(parent) ?? [];
    siblings.push(thread);
    children.set(parent, siblings);
  }
  let latestCompletedAt = 0;
  let live = 0;
  const visited = new Set<ThreadId>();
  const visit = (thread: FamilyShell, isChild: boolean) => {
    if (visited.has(thread.id)) return;
    visited.add(thread.id);
    if (thread.latestRunCompletedAt != null) {
      latestCompletedAt = Math.max(
        latestCompletedAt,
        DateTime.toEpochMillis(thread.latestRunCompletedAt),
      );
    }
    if (isChild && isLiveSubagentShell(thread)) live += 1;
    for (const child of children.get(thread.id) ?? []) visit(child, true);
  };
  if (self !== undefined) visit(self, false);
  return `${latestCompletedAt}:${live}`;
}

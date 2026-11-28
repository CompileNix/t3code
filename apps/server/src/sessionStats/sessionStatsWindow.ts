import {
  EMPTY_SESSION_STATS_TOTALS,
  type SessionStatsAgentTime,
  type SessionStatsToolCategory,
  type SessionStatsTotals,
  type TurnTokenUsage,
} from "@t3tools/contracts";

export interface WindowItem {
  readonly type: string;
  readonly startedAt: number | null;
  readonly completedAt: number | null;
  readonly remoteChild: boolean;
}

export interface WindowProviderTurn {
  readonly driver: string;
  readonly usage: TurnTokenUsage | undefined;
}

export interface WindowSpan {
  readonly startedAt: number;
  readonly completedAt: number;
}

export interface WindowInput {
  readonly span: WindowSpan;
  readonly items: ReadonlyArray<WindowItem>;
  readonly waits: ReadonlyArray<WindowSpan>;
  readonly providerTurns: ReadonlyArray<WindowProviderTurn>;
}

const TOOL_CATEGORY: Readonly<Record<string, SessionStatsToolCategory>> = {
  command_execution: "command",
  file_change: "fileChange",
  file_search: "search",
  web_search: "web",
  dynamic_tool: "mcp",
  subagent: "subagent",
};

type TimedCategory = Exclude<keyof SessionStatsAgentTime, "otherMs"> | "waitingMs";

// When spans overlap, the higher one owns the time, so the categories add up to the window.
const PRIORITY: ReadonlyArray<TimedCategory> = ["waitingMs", "toolMs", "outputMs", "reasoningMs"];

function timedCategory(type: string): TimedCategory | undefined {
  if (type in TOOL_CATEGORY) return "toolMs";
  if (type === "assistant_message") return "outputMs";
  if (type === "reasoning") return "reasoningMs";
  return undefined;
}

/** Time waiting on the user is left out of every category and returned apart. */
function agentTime(input: WindowInput): {
  readonly time: SessionStatsAgentTime;
  readonly waitingMs: number;
} {
  const { startedAt: start, completedAt: end } = input.span;
  const edges: Array<{ at: number; category: TimedCategory; delta: 1 | -1 }> = [];
  const addSpan = (category: TimedCategory, from: number, to: number) => {
    const clippedFrom = Math.max(from, start);
    const clippedTo = Math.min(to, end);
    if (clippedTo <= clippedFrom) return;
    edges.push({ at: clippedFrom, category, delta: 1 }, { at: clippedTo, category, delta: -1 });
  };
  for (const item of input.items) {
    const category = timedCategory(item.type);
    if (category === undefined || item.startedAt === null) continue;
    addSpan(category, item.startedAt, item.completedAt ?? end);
  }
  for (const wait of input.waits) addSpan("waitingMs", wait.startedAt, wait.completedAt);
  edges.sort((a, b) => a.at - b.at);

  const open: Record<TimedCategory, number> = {
    waitingMs: 0,
    toolMs: 0,
    outputMs: 0,
    reasoningMs: 0,
  };
  const time = { ...EMPTY_SESSION_STATS_TOTALS.agentTime, waitingMs: 0 };
  let cursor = start;
  let covered = 0;
  for (const edge of edges) {
    const owner = PRIORITY.find((category) => open[category] > 0);
    if (owner !== undefined && edge.at > cursor) {
      time[owner] += edge.at - cursor;
      covered += edge.at - cursor;
    }
    cursor = Math.max(cursor, edge.at);
    open[edge.category] += edge.delta;
  }
  const { waitingMs, ...phases } = time;
  return { time: { ...phases, otherMs: Math.max(0, end - start - covered) }, waitingMs };
}

/** One finished window's totals; `wallMs` is left for the caller to keep or drop. */
export function windowTotals(input: WindowInput): SessionStatsTotals {
  const toolCalls = { ...EMPTY_SESSION_STATS_TOTALS.toolCalls };
  let remoteDelegations = 0;
  for (const item of input.items) {
    const category = TOOL_CATEGORY[item.type];
    if (category === undefined) continue;
    toolCalls[category] += 1;
    if (item.remoteChild) remoteDelegations += 1;
  }

  const tokens = { ...EMPTY_SESSION_STATS_TOTALS.tokens };
  const unreported = new Set<string>();
  const reportedDrivers = new Set<string>();
  let reported = 0;
  for (const { driver, usage } of input.providerTurns) {
    if (usage?.inputTokens === undefined && usage?.outputTokens === undefined) {
      unreported.add(driver);
      continue;
    }
    reported += 1;
    reportedDrivers.add(driver);
    const input = usage.inputTokens ?? 0;
    const cacheRead = usage.cachedInputTokens ?? 0;
    const cacheWrite = usage.cacheCreationTokens ?? 0;
    tokens.uncachedInputTokens += Math.max(0, input - cacheRead - cacheWrite);
    tokens.cacheReadTokens += cacheRead;
    tokens.cacheWriteTokens += cacheWrite;
    tokens.outputTokens += usage.outputTokens ?? 0;
    tokens.reasoningTokens += usage.reasoningTokens ?? 0;
    tokens.otherInputTokens += usage.otherUsage?.inputTokens ?? 0;
    tokens.otherOutputTokens += usage.otherUsage?.outputTokens ?? 0;
  }

  const { time, waitingMs } = agentTime(input);
  return {
    wallMs: Math.max(0, input.span.completedAt - input.span.startedAt - waitingMs),
    agentTime: time,
    tokens,
    turns: { total: input.providerTurns.length, reported },
    toolCalls,
    unreportedProviders: [...unreported].filter((driver) => !reportedDrivers.has(driver)).sort(),
    reportedProviders: [...reportedDrivers].sort(),
    remoteDelegations,
  };
}

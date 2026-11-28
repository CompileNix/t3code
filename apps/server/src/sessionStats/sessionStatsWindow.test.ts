import { describe, expect, it } from "@effect/vitest";

import { windowTotals, type WindowItem } from "./sessionStatsWindow.ts";

const item = (type: string, startedAt: number, completedAt: number | null): WindowItem => ({
  type,
  startedAt,
  completedAt,
  remoteChild: false,
});

describe("windowTotals", () => {
  it("splits time by priority so parallel and overlapping spans add up to the window", () => {
    const totals = windowTotals({
      span: { startedAt: 0, completedAt: 100 },
      items: [
        item("reasoning", 0, 20),
        item("assistant_message", 15, 30),
        // Two tools in parallel count once, as wall-clock time.
        item("command_execution", 40, 70),
        item("dynamic_tool", 50, 80),
        // Still running at the window's end, so it ends with the window.
        item("reasoning", 90, null),
        // Clipped to the window.
        item("web_search", -10, 5),
      ],
      waits: [{ startedAt: 60, completedAt: 65 }],
      providerTurns: [],
    });
    expect(totals.wallMs).toBe(100 - 5);
    expect(totals.agentTime).toEqual({
      toolMs: 5 + 35,
      outputMs: 15,
      reasoningMs: 10 + 10,
      otherMs: 100 - 5 - 40 - 15 - 20,
    });
    expect(totals.toolCalls).toEqual({
      command: 1,
      fileChange: 0,
      search: 0,
      web: 1,
      mcp: 1,
      subagent: 0,
    });
  });

  it("separates uncached input from cache reads and writes and flags turns without counts", () => {
    const totals = windowTotals({
      span: { startedAt: 0, completedAt: 1 },
      items: [{ ...item("subagent", 0, 1), remoteChild: true }],
      waits: [],
      providerTurns: [
        {
          driver: "claudeAgent",
          usage: {
            usageStatus: "complete",
            usageScope: "main_agent",
            hasSubagents: true,
            inputTokens: 1_000,
            cachedInputTokens: 600,
            cacheCreationTokens: 100,
            outputTokens: 50,
            reasoningTokens: 20,
            otherUsage: { inputTokens: 7, outputTokens: 3 },
          },
        },
        { driver: "cursor", usage: undefined },
        // An interrupted turn without counts does not mark a driver that reported elsewhere.
        { driver: "claudeAgent", usage: undefined },
        {
          driver: "grok",
          usage: { usageStatus: "unavailable", usageScope: "main_agent", hasSubagents: false },
        },
      ],
    });
    expect(totals.tokens).toEqual({
      uncachedInputTokens: 300,
      cacheReadTokens: 600,
      cacheWriteTokens: 100,
      outputTokens: 50,
      reasoningTokens: 20,
      otherInputTokens: 7,
      otherOutputTokens: 3,
    });
    expect(totals.turns).toEqual({ total: 4, reported: 1 });
    expect(totals.unreportedProviders).toEqual(["cursor", "grok"]);
    expect(totals.reportedProviders).toEqual(["claudeAgent"]);
    expect(totals.remoteDelegations).toBe(1);
  });
});

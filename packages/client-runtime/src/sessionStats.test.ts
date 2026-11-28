import { ThreadId, UsageDay } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { describe, expect, it } from "vite-plus/test";

import { sessionStatsRange, sessionStatsRefreshKey } from "./sessionStats.ts";

describe("sessionStatsRange", () => {
  it("spans whole days in the viewer's zone, across a DST change", () => {
    expect(
      sessionStatsRange({
        sinceDay: UsageDay.make("2026-03-28"),
        untilDay: UsageDay.make("2026-03-29"),
        timeZone: "Europe/Berlin",
      }),
    ).toEqual({
      since: "2026-03-27T23:00:00.000Z",
      // Berlin moves to summer time on the 29th, so the next midnight is UTC+2.
      until: "2026-03-29T22:00:00.000Z",
    });
  });

  it("keeps an hourly window's exact instants", () => {
    expect(
      sessionStatsRange({
        sinceDay: UsageDay.make("2026-01-01"),
        untilDay: UsageDay.make("2026-01-02"),
        timeZone: "UTC",
        sinceTime: "2026-01-01T10:00:00.000Z",
        untilTime: "2026-01-02T10:00:00.000Z",
      }),
    ).toEqual({ since: "2026-01-01T10:00:00.000Z", until: "2026-01-02T10:00:00.000Z" });
  });
});

describe("sessionStatsRefreshKey", () => {
  const ROOT = ThreadId.make("root");
  const shell = (
    id: string,
    parent: ThreadId | null,
    completedAt: string | null,
    status: "idle" | "running" = "idle",
  ) => ({
    id: ThreadId.make(id),
    lineage: {
      parentThreadId: parent,
      relationshipToParent: parent === null ? null : ("subagent" as const),
      rootThreadId: ROOT,
    },
    latestRunCompletedAt: completedAt === null ? null : DateTime.makeUnsafe(completedAt),
    activityRunStatus: null,
    status,
    pendingRuntimeRequest: null,
    pendingBackgroundTasks: [],
  });

  it("changes when a run in the family ends or a live subagent goes idle, not otherwise", () => {
    const root = shell("root", null, "2026-01-01T00:00:00.000Z");
    const running = sessionStatsRefreshKey(
      [
        root,
        shell("child", ROOT, null, "running"),
        shell("grandchild", ThreadId.make("child"), null, "running"),
      ],
      ROOT,
    );
    // Another thread's run ending does not touch this family.
    expect(
      sessionStatsRefreshKey(
        [
          root,
          shell("child", ROOT, null, "running"),
          shell("grandchild", ThreadId.make("child"), null, "running"),
          shell("other", null, "2026-01-02T00:00:00.000Z"),
        ],
        ROOT,
      ),
    ).toBe(running);
    const grandchildDone = sessionStatsRefreshKey(
      [
        root,
        shell("child", ROOT, null, "running"),
        shell("grandchild", ThreadId.make("child"), "2026-01-01T00:01:00.000Z"),
      ],
      ROOT,
    );
    expect(grandchildDone).not.toBe(running);
    // Run-less subagents never complete a run; the shell drops them once idle.
    expect(sessionStatsRefreshKey([root], ROOT)).not.toBe(grandchildDone);
  });
});

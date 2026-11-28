import {
  addSessionStatsTotals,
  EMPTY_SESSION_STATS_TOTALS,
  OrchestrationV2ProviderTurn,
  OrchestrationV2RunStatus,
  ProjectId,
  SessionStatsReadError,
  sessionStatsTotalTokens,
  SessionStatsTotals,
  ThreadId,
  TurnTokenUsage,
  type GetSessionStatsRollupInput,
  type GetThreadSessionStatsInput,
  type OrchestrationV2DomainEvent,
  type SessionStatsRollup,
  type ThreadSessionStats,
} from "@t3tools/contracts";
import { makeDrainableWorker } from "@t3tools/shared/DrainableWorker";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import * as SqlClient from "effect/sql/SqlClient";
import * as SqlSchema from "effect/sql/SqlSchema";
import * as Stream from "effect/Stream";

import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import { isTerminalProviderTurnStatus } from "../orchestration-v2/RunExecutionService.ts";
import { isTerminalRunStatus } from "../orchestration-v2/ThreadManagementService.ts";
import { forkParked } from "../serverActivation.ts";
import { ensureSessionStatsSchema } from "./sessionStatsSchema.ts";
import { windowTotals, type WindowItem, type WindowSpan } from "./sessionStatsWindow.ts";

const ACTIVE_ITEM_STATUSES = ["pending", "running", "waiting"];
// Only these types carry time or tool counts; skipping the rest keeps window reads small.
const COUNTED_ITEM_TYPES = [
  "assistant_message",
  "reasoning",
  "command_execution",
  "file_change",
  "file_search",
  "web_search",
  "dynamic_tool",
  "subagent",
];

const RunRow = Schema.Struct({
  runId: Schema.String,
  status: OrchestrationV2RunStatus,
  requestedAt: Schema.String,
  startedAt: Schema.NullOr(Schema.String),
  completedAt: Schema.NullOr(Schema.String),
});
const ItemGroupRow = Schema.Struct({
  runId: Schema.NullOr(Schema.String),
  providerTurnId: Schema.NullOr(Schema.String),
  count: Schema.Number,
  updatedAt: Schema.String,
  active: Schema.Number,
});
const ProviderTurnRow = Schema.Struct({
  providerTurnId: Schema.String,
  runId: Schema.NullOr(Schema.String),
  status: OrchestrationV2ProviderTurn.fields.status,
  startedAt: Schema.NullOr(Schema.String),
  completedAt: Schema.NullOr(Schema.String),
  driver: Schema.NullOr(Schema.String),
  usage: Schema.NullOr(Schema.fromJsonString(TurnTokenUsage)),
});
const ItemRow = Schema.Struct({
  type: Schema.String,
  startedAt: Schema.NullOr(Schema.String),
  completedAt: Schema.NullOr(Schema.String),
  remoteChild: Schema.Number,
});
const WaitRow = Schema.Struct({
  createdAt: Schema.String,
  resolvedAt: Schema.NullOr(Schema.String),
});
const StoredWindowRow = Schema.Struct({
  windowId: Schema.String,
  sourceKey: Schema.String,
});
const StatsRow = Schema.Struct({
  threadId: ThreadId,
  topLevel: Schema.Number,
  completedAt: Schema.String,
  stats: Schema.fromJsonString(SessionStatsTotals),
});
const RollupRow = Schema.Struct({
  projectId: ProjectId,
  title: Schema.String,
  threadId: ThreadId,
  topLevel: Schema.Number,
  stats: Schema.fromJsonString(SessionStatsTotals),
});

type ProviderTurnRow = typeof ProviderTurnRow.Type;
type WaitRow = typeof WaitRow.Type;

type WindowSelector =
  | { readonly kind: "run"; readonly runId: string }
  | { readonly kind: "turn"; readonly providerTurnId: string }
  | { readonly kind: "envelope"; readonly threadId: ThreadId };

interface PendingWindow {
  readonly windowId: string;
  readonly selector: WindowSelector;
  readonly completedAt: string;
  readonly sourceKey: string;
  /** Null when the span comes from the window's own items. */
  readonly startedAt: string | null;
  readonly providerTurns: ReadonlyArray<ProviderTurnRow>;
}

const millis = (iso: string) => Date.parse(iso);

// Bump when window math changes, so the startup backfill recomputes every stored row.
const STATS_VERSION = "v3";

const groupKey = (group: typeof ItemGroupRow.Type | undefined) =>
  group === undefined ? "0" : `${group.count}@${group.updatedAt}`;

const turnsKey = (turns: ReadonlyArray<ProviderTurnRow>) =>
  turns
    .map(
      (turn) =>
        `${turn.providerTurnId}:${turn.status}:${turn.usage?.usageStatus ?? "-"}:` +
        `${turn.usage?.inputTokens ?? "-"}/${turn.usage?.outputTokens ?? "-"}`,
    )
    .join(",");

/** The waits that count toward a window; an open wait counts only in the window it began in. */
function windowWaits(
  waits: ReadonlyArray<WaitRow>,
  start: number,
  end: number,
): ReadonlyArray<WindowSpan> {
  return waits.flatMap((wait) => {
    const from = millis(wait.createdAt);
    if (wait.resolvedAt === null) {
      return from >= start && from < end ? [{ startedAt: from, completedAt: end }] : [];
    }
    const to = millis(wait.resolvedAt);
    return from < end && to > start ? [{ startedAt: from, completedAt: to }] : [];
  });
}

const waitsKey = (waits: ReadonlyArray<WaitRow>, startedAt: string | null, completedAt: string) =>
  windowWaits(
    waits,
    startedAt === null ? Number.NEGATIVE_INFINITY : millis(startedAt),
    millis(completedAt),
  )
    .map((wait) => `${wait.startedAt}-${wait.completedAt}`)
    .join(",");

/** The finished windows of one thread: its runs, or for run-less child threads its turns. */
function finishedWindows(input: {
  readonly threadId: ThreadId;
  readonly runs: ReadonlyArray<typeof RunRow.Type>;
  readonly groups: ReadonlyArray<typeof ItemGroupRow.Type>;
  readonly providerTurns: ReadonlyArray<ProviderTurnRow>;
  readonly waits: ReadonlyArray<WaitRow>;
}): ReadonlyArray<PendingWindow> {
  const terminalTurns = input.providerTurns.filter((turn) =>
    isTerminalProviderTurnStatus(turn.status),
  );
  if (input.runs.length > 0) {
    return input.runs.flatMap((run) => {
      if (run.completedAt === null || !isTerminalRunStatus(run.status)) return [];
      const turns = terminalTurns.filter((turn) => turn.runId === run.runId);
      const items = input.groups.filter((group) => group.runId === run.runId);
      const startedAt = run.startedAt ?? run.requestedAt;
      return [
        {
          windowId: run.runId,
          selector: { kind: "run", runId: run.runId },
          completedAt: run.completedAt,
          startedAt,
          providerTurns: turns,
          sourceKey: [
            STATS_VERSION,
            run.completedAt,
            run.status,
            items.map(groupKey).join("+"),
            turnsKey(turns),
            waitsKey(input.waits, startedAt, run.completedAt),
          ].join("|"),
        } satisfies PendingWindow,
      ];
    });
  }
  const turnWindows = terminalTurns.flatMap((turn) => {
    if (turn.runId !== null || turn.completedAt === null) return [];
    const group = input.groups.find(
      (candidate) => candidate.runId === null && candidate.providerTurnId === turn.providerTurnId,
    );
    return [
      {
        windowId: turn.providerTurnId,
        selector: { kind: "turn", providerTurnId: turn.providerTurnId },
        completedAt: turn.completedAt,
        startedAt: turn.startedAt,
        providerTurns: [turn],
        sourceKey: [
          STATS_VERSION,
          turn.completedAt,
          groupKey(group),
          turnsKey([turn]),
          waitsKey(input.waits, turn.startedAt, turn.completedAt),
        ].join("|"),
      } satisfies PendingWindow,
    ];
  });
  // Claude's subagent threads have items but neither runs nor provider turns.
  const loose = input.groups.find((group) => group.runId === null && group.providerTurnId === null);
  if (loose === undefined || loose.active > 0) return turnWindows;
  return [
    ...turnWindows,
    {
      windowId: `envelope:${input.threadId}`,
      selector: { kind: "envelope", threadId: input.threadId },
      completedAt: loose.updatedAt,
      startedAt: null,
      providerTurns: [],
      sourceKey: [
        STATS_VERSION,
        groupKey(loose),
        waitsKey(input.waits, null, loose.updatedAt),
      ].join("|"),
    },
  ];
}

function sumRows<Row extends { readonly stats: SessionStatsTotals }>(
  rows: ReadonlyArray<Row>,
  keepWall: (row: Row) => boolean,
) {
  return rows.reduce(
    (sum, row) =>
      addSessionStatsTotals(sum, keepWall(row) ? row.stats : { ...row.stats, wallMs: 0 }),
    EMPTY_SESSION_STATS_TOTALS,
  );
}

export class SessionStatsService extends Context.Service<
  SessionStatsService,
  {
    readonly getThreadSessionStats: (
      input: GetThreadSessionStatsInput,
    ) => Effect.Effect<ThreadSessionStats, SessionStatsReadError>;
    /** Waits for `start`'s startup backfill; turns that end later count once the follower runs. */
    readonly getSessionStatsRollup: (
      input: GetSessionStatsRollupInput,
    ) => Effect.Effect<SessionStatsRollup, SessionStatsReadError>;
    /** Follows finished turns and fills in rows for threads that finished before this server. */
    readonly start: () => Effect.Effect<void, never, Scope.Scope>;
    readonly drain: Effect.Effect<void>;
  }
>()("t3/sessionStats/SessionStatsService") {}

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  // Before any read or write: the table is not part of the migration ledger.
  yield* ensureSessionStatsSchema;
  const orchestrator = yield* Orchestrator.OrchestratorV2;

  const ThreadIdRequest = Schema.Struct({ threadId: Schema.String });

  const readRuns = SqlSchema.findAll({
    Request: ThreadIdRequest,
    Result: RunRow,
    execute: ({ threadId }) => sql`
      SELECT
        run_id AS "runId",
        status,
        requested_at AS "requestedAt",
        json_extract(payload_json, '$.startedAt') AS "startedAt",
        completed_at AS "completedAt"
      FROM orchestration_v2_projection_runs
      WHERE thread_id = ${threadId}
    `,
  });

  const readItemGroups = SqlSchema.findAll({
    Request: ThreadIdRequest,
    Result: ItemGroupRow,
    execute: ({ threadId }) => sql`
      SELECT
        run_id AS "runId",
        provider_turn_id AS "providerTurnId",
        COUNT(*) AS count,
        MAX(updated_at) AS "updatedAt",
        SUM(status IN ${sql.in(ACTIVE_ITEM_STATUSES)}) AS active
      FROM orchestration_v2_projection_turn_items
      WHERE thread_id = ${threadId}
      GROUP BY run_id, provider_turn_id
    `,
  });

  const readProviderTurns = SqlSchema.findAll({
    Request: ThreadIdRequest,
    Result: ProviderTurnRow,
    execute: ({ threadId }) => sql`
      SELECT
        turns.provider_turn_id AS "providerTurnId",
        attempts.run_id AS "runId",
        turns.status,
        turns.started_at AS "startedAt",
        turns.completed_at AS "completedAt",
        provider_threads.driver AS driver,
        json_extract(turns.payload_json, '$.turnTokenUsage') AS usage
      FROM orchestration_v2_projection_provider_turns AS turns
      LEFT JOIN orchestration_v2_projection_run_attempts AS attempts
        ON attempts.attempt_id = turns.run_attempt_id
      LEFT JOIN orchestration_v2_projection_provider_threads AS provider_threads
        ON provider_threads.provider_thread_id = turns.provider_thread_id
      WHERE turns.thread_id = ${threadId}
    `,
  });

  const readStoredWindows = SqlSchema.findAll({
    Request: ThreadIdRequest,
    Result: StoredWindowRow,
    execute: ({ threadId }) => sql`
      SELECT window_id AS "windowId", source_key AS "sourceKey"
      FROM orchestration_v2_session_stats_windows
      WHERE thread_id = ${threadId}
    `,
  });

  const readWaits = SqlSchema.findAll({
    Request: ThreadIdRequest,
    Result: WaitRow,
    execute: ({ threadId }) => sql`
      SELECT created_at AS "createdAt", resolved_at AS "resolvedAt"
      FROM orchestration_v2_projection_runtime_requests
      WHERE thread_id = ${threadId}
    `,
  });

  const itemColumns = sql`
    type,
    json_extract(payload_json, '$.startedAt') AS "startedAt",
    json_extract(payload_json, '$.completedAt') AS "completedAt",
    json_extract(payload_json, '$.remoteChild') IS NOT NULL AS "remoteChild"
  `;
  const decodeItems = Schema.decodeUnknownEffect(Schema.Array(ItemRow));
  const readWindowItems = (selector: WindowSelector) =>
    (selector.kind === "run"
      ? sql`
          SELECT ${itemColumns} FROM orchestration_v2_projection_turn_items
          WHERE run_id = ${selector.runId} AND type IN ${sql.in(COUNTED_ITEM_TYPES)}
        `
      : selector.kind === "turn"
        ? sql`
            SELECT ${itemColumns} FROM orchestration_v2_projection_turn_items
            WHERE provider_turn_id = ${selector.providerTurnId} AND run_id IS NULL
              AND type IN ${sql.in(COUNTED_ITEM_TYPES)}
          `
        : sql`
            SELECT ${itemColumns} FROM orchestration_v2_projection_turn_items
            WHERE thread_id = ${selector.threadId} AND run_id IS NULL
              AND provider_turn_id IS NULL AND type IN ${sql.in(COUNTED_ITEM_TYPES)}
          `
    ).pipe(Effect.flatMap(decodeItems));

  const readTopLevel = SqlSchema.findAll({
    Request: ThreadIdRequest,
    Result: Schema.Struct({ topLevel: Schema.Number }),
    execute: ({ threadId }) => sql`
      SELECT
        COALESCE(json_extract(payload_json, '$.lineage.relationshipToParent'), '') != 'subagent'
          AS "topLevel"
      FROM orchestration_v2_projection_threads
      WHERE thread_id = ${threadId}
    `,
  });

  const encodeStats = Schema.encodeEffect(Schema.fromJsonString(SessionStatsTotals));

  const toMillis = (iso: string | null) => (iso === null ? null : millis(iso));

  // Untraced: it runs once per stale window inside refreshThread's span.
  const computeWindow = Effect.fnUntraced(function* (
    window: PendingWindow,
    waits: ReadonlyArray<WaitRow>,
  ) {
    const rows = yield* readWindowItems(window.selector);
    const items: ReadonlyArray<WindowItem> = rows.map((row) => ({
      type: row.type,
      startedAt: toMillis(row.startedAt),
      completedAt: toMillis(row.completedAt),
      remoteChild: row.remoteChild !== 0,
    }));
    const completedAt = millis(window.completedAt);
    const itemStarts = items.flatMap((item) => (item.startedAt === null ? [] : [item.startedAt]));
    const itemEnds = items.flatMap((item) => (item.completedAt === null ? [] : [item.completedAt]));
    const startedAt =
      toMillis(window.startedAt) ?? (itemStarts.length > 0 ? Math.min(...itemStarts) : completedAt);
    const end =
      window.selector.kind === "envelope" && itemEnds.length > 0
        ? Math.max(...itemEnds)
        : completedAt;
    const span: WindowSpan = { startedAt: Math.min(startedAt, end), completedAt: end };
    return windowTotals({
      span,
      items,
      waits: windowWaits(waits, span.startedAt, span.completedAt),
      providerTurns: window.providerTurns.map((turn) => ({
        driver: turn.driver ?? "unknown",
        usage: turn.usage ?? undefined,
      })),
    });
  });

  // Reads and the follower both refresh; one at a time so an older result never overwrites a newer.
  const refreshLock = yield* Semaphore.make(1);

  /** Recomputes the thread's finished windows whose sources changed since they were stored. */
  const refreshThread = Effect.fn("SessionStatsService.refreshThread")(function* (
    threadId: ThreadId,
  ) {
    const [runs, groups, providerTurns, stored, waits] = yield* Effect.all([
      readRuns({ threadId }),
      readItemGroups({ threadId }),
      readProviderTurns({ threadId }),
      readStoredWindows({ threadId }),
      readWaits({ threadId }),
    ]);
    const storedKeys = new Map(stored.map((row) => [row.windowId, row.sourceKey]));
    const stale = finishedWindows({ threadId, runs, groups, providerTurns, waits }).filter(
      (window) => storedKeys.get(window.windowId) !== window.sourceKey,
    );
    if (stale.length === 0) return;
    const [lineage] = yield* readTopLevel({ threadId });
    const topLevel = lineage?.topLevel ?? 1;
    for (const window of stale) {
      const stats = yield* computeWindow(window, waits).pipe(Effect.flatMap(encodeStats));
      yield* sql`
        INSERT INTO orchestration_v2_session_stats_windows
          (window_id, thread_id, top_level, completed_at, source_key, stats_json)
        VALUES (
          ${window.windowId}, ${threadId}, ${topLevel}, ${window.completedAt},
          ${window.sourceKey}, ${stats}
        )
        ON CONFLICT (window_id) DO UPDATE SET
          thread_id = excluded.thread_id,
          top_level = excluded.top_level,
          completed_at = excluded.completed_at,
          source_key = excluded.source_key,
          stats_json = excluded.stats_json
      `;
    }
  }, refreshLock.withPermits(1));

  const readFamily = SqlSchema.findAll({
    Request: ThreadIdRequest,
    Result: Schema.Struct({ threadId: ThreadId }),
    execute: ({ threadId }) => sql`
      WITH RECURSIVE family(thread_id) AS (
        SELECT ${threadId}
        UNION
        SELECT threads.thread_id
        FROM orchestration_v2_projection_threads AS threads
        INNER JOIN family
          ON json_extract(threads.payload_json, '$.lineage.parentThreadId') = family.thread_id
        WHERE json_extract(threads.payload_json, '$.lineage.relationshipToParent') = 'subagent'
          AND threads.deleted_at IS NULL
      )
      SELECT thread_id AS "threadId" FROM family
    `,
  });

  const readFamilyStats = SqlSchema.findAll({
    Request: Schema.Struct({ threadIds: Schema.Array(Schema.String) }),
    Result: StatsRow,
    execute: ({ threadIds }) => sql`
      SELECT
        thread_id AS "threadId",
        top_level AS "topLevel",
        completed_at AS "completedAt",
        stats_json AS stats
      FROM orchestration_v2_session_stats_windows
      WHERE thread_id IN ${sql.in(threadIds)}
    `,
  });

  const readRollupRows = SqlSchema.findAll({
    Request: Schema.Struct({
      since: Schema.NullOr(Schema.String),
      until: Schema.NullOr(Schema.String),
    }),
    Result: RollupRow,
    execute: ({ since, until }) => sql`
      SELECT
        threads.project_id AS "projectId",
        COALESCE(projects.title, '') AS title,
        windows.thread_id AS "threadId",
        windows.top_level AS "topLevel",
        windows.stats_json AS stats
      FROM orchestration_v2_session_stats_windows AS windows
      INNER JOIN orchestration_v2_projection_threads AS threads
        ON threads.thread_id = windows.thread_id
      LEFT JOIN projection_projects AS projects
        ON projects.project_id = threads.project_id
      WHERE threads.deleted_at IS NULL
        AND (${since} IS NULL OR windows.completed_at >= ${since})
        AND (${until} IS NULL OR windows.completed_at < ${until})
    `,
  });

  const pending = new Set<ThreadId>();
  const worker = yield* makeDrainableWorker((threadId: ThreadId) =>
    Effect.suspend(() => {
      pending.delete(threadId);
      return refreshThread(threadId);
    }).pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning("session stats refresh failed", { threadId, cause }),
      ),
    ),
  );
  const request = (threadId: ThreadId) =>
    Effect.suspend(() => {
      if (pending.has(threadId)) return Effect.void;
      pending.add(threadId);
      return worker.enqueue(threadId);
    });
  const backfilled = yield* Deferred.make<void>();

  // Stored ends are `formatIso` strings, so bounds compare as text once they share that form.
  const normalizeInstant = (iso: string | undefined) =>
    iso === undefined ? null : DateTime.formatIso(DateTime.makeUnsafe(iso));

  const getThreadSessionStats: SessionStatsService["Service"]["getThreadSessionStats"] = Effect.fn(
    "SessionStatsService.getThreadSessionStats",
  )(
    function* (input) {
      const [familyRows, runs] = yield* Effect.all([
        readFamily({ threadId: input.threadId }),
        readRuns({ threadId: input.threadId }),
      ]);
      const family = familyRows.map((row) => row.threadId);
      // Reads must not wait on the follower, so a turn that just ended is counted at once.
      yield* Effect.forEach(family, refreshThread, { discard: true });
      const rows = yield* readFamilyStats({ threadIds: family });
      // While the thread runs, its children's work in that turn waits for the turn, as its own does.
      const runStarts = runs.flatMap((run) =>
        isTerminalRunStatus(run.status) ? [] : [millis(run.startedAt ?? run.requestedAt)],
      );
      const runningSince = runStarts.length > 0 ? Math.min(...runStarts) : null;
      const counted =
        runningSince === null
          ? rows
          : rows.filter(
              (row) => row.threadId === input.threadId || millis(row.completedAt) < runningSince,
            );
      return {
        threadId: input.threadId,
        threadCount: family.length,
        totals: sumRows(counted, (row) => row.threadId === input.threadId),
      };
    },
    Effect.mapError((cause) => new SessionStatsReadError({ cause })),
  );

  const getSessionStatsRollup: SessionStatsService["Service"]["getSessionStatsRollup"] = Effect.fn(
    "SessionStatsService.getSessionStatsRollup",
  )(function* (input) {
    // Waits out the startup backfill rather than undercounting; the follower may lag a turn.
    yield* Deferred.await(backfilled);
    const rows = yield* readRollupRows({
      since: normalizeInstant(input.since),
      until: normalizeInstant(input.until),
    }).pipe(Effect.mapError((cause) => new SessionStatsReadError({ cause })));
    const byProject = new Map<string, Array<typeof RollupRow.Type>>();
    for (const row of rows) {
      const projectRows = byProject.get(row.projectId) ?? [];
      projectRows.push(row);
      byProject.set(row.projectId, projectRows);
    }
    const isTopLevel = (row: typeof RollupRow.Type) => row.topLevel !== 0;
    const projects = [...byProject.values()].map((projectRows) => ({
      projectId: projectRows[0]!.projectId,
      title: projectRows[0]!.title,
      threadCount: new Set(projectRows.filter(isTopLevel).map((row) => row.threadId)).size,
      totals: sumRows(projectRows, isTopLevel),
    }));
    projects.sort(
      (a, b) =>
        sessionStatsTotalTokens(b.totals) - sessionStatsTotalTokens(a.totals) ||
        a.title.localeCompare(b.title),
    );
    return { projects, totals: sumRows(rows, isTopLevel) };
  });

  const refreshTrigger = (event: OrchestrationV2DomainEvent): ThreadId | undefined => {
    switch (event.type) {
      case "run.updated":
        return isTerminalRunStatus(event.payload.status) ? event.threadId : undefined;
      case "provider-turn.updated":
        return isTerminalProviderTurnStatus(event.payload.status) ? event.threadId : undefined;
      // Run-less subagent threads only finish through their items.
      case "turn-item.updated":
        return event.payload.runId === null && !ACTIVE_ITEM_STATUSES.includes(event.payload.status)
          ? event.threadId
          : undefined;
      default:
        return undefined;
    }
  };

  const readAllThreadIds = SqlSchema.findAll({
    Request: Schema.Void,
    Result: Schema.Struct({ threadId: ThreadId }),
    execute: () => sql`
      SELECT thread_id AS "threadId" FROM orchestration_v2_projection_threads
      WHERE deleted_at IS NULL
    `,
  });

  const start: SessionStatsService["Service"]["start"] = Effect.fn("SessionStatsService.start")(
    function* () {
      yield* forkParked(
        Stream.runForEach(orchestrator.streamDomainEvents, (event) => {
          const threadId = refreshTrigger(event);
          return threadId === undefined ? Effect.void : request(threadId);
        }).pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning("session stats event stream failed", { cause }),
          ),
        ),
      );
      // Fills in threads that finished before this server ran, including on first upgrade.
      yield* forkParked(
        readAllThreadIds(undefined).pipe(
          Effect.flatMap((rows) =>
            Effect.forEach(
              rows,
              (row) =>
                refreshThread(row.threadId).pipe(
                  Effect.catchCause((cause) =>
                    Effect.logWarning("session stats backfill failed", {
                      threadId: row.threadId,
                      cause,
                    }),
                  ),
                ),
              { discard: true },
            ),
          ),
          Effect.catchCause((cause) =>
            Effect.logWarning("session stats backfill failed", { cause }),
          ),
          Effect.ensuring(Deferred.succeed(backfilled, undefined)),
        ),
      );
    },
  );

  return SessionStatsService.of({
    getThreadSessionStats,
    getSessionStatsRollup,
    start,
    drain: worker.drain,
  });
});

export const layer = Layer.effect(SessionStatsService, make);

import { assert, it } from "@effect/vitest";
import {
  EventId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  RunId,
  ThreadId,
  type OrchestrationV2DomainEvent,
} from "@t3tools/contracts";
import type * as Cause from "effect/Cause";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as SqlClient from "effect/sql/SqlClient";
import * as Stream from "effect/Stream";

import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as SessionStats from "./SessionStatsService.ts";

const layerWith = (
  streamDomainEvents: Orchestrator.OrchestratorV2["Service"]["streamDomainEvents"],
) =>
  SessionStats.layer.pipe(
    Layer.provide(Layer.mock(Orchestrator.OrchestratorV2)({ streamDomainEvents })),
    Layer.provideMerge(SqlitePersistence.layerMemory),
  );

const PROJECT = ProjectId.make("project-1");
const ROOT = ThreadId.make("root");
const CHILD = ThreadId.make("child");
const LATE_CHILD = ThreadId.make("late-child");
const FORK = ThreadId.make("fork");
const DELETED = ThreadId.make("deleted");

const usage = (inputTokens: number) => ({
  turnTokenUsage: {
    usageStatus: "complete",
    usageScope: "main_agent",
    hasSubagents: false,
    inputTokens,
    cachedInputTokens: 60,
    outputTokens: 10,
  },
});

const providerThread = (threadId: string, instance: string, driver: string) =>
  Effect.flatMap(
    SqlClient.SqlClient,
    (sql) => sql`
      INSERT OR IGNORE INTO orchestration_v2_projection_provider_threads
        (provider_thread_id, thread_id, provider, driver, status, updated_at, payload_json)
      VALUES (${`${threadId}:pt`}, ${threadId}, ${instance}, ${driver}, 'idle',
        '2026-01-01T00:00:00.000Z', '{}')
    `,
  );

const run = (input: {
  readonly threadId: string;
  readonly runId: string;
  readonly ordinal: number;
  readonly startedAt: string;
  readonly completedAt: string | null;
  readonly status?: string;
  readonly reported?: boolean;
}) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const status = input.status ?? (input.completedAt === null ? "running" : "completed");
    yield* sql`
      INSERT INTO orchestration_v2_projection_runs
        (run_id, thread_id, ordinal, provider, status, requested_at, completed_at, payload_json)
      VALUES (${input.runId}, ${input.threadId}, ${input.ordinal}, 'claudeAgent', ${status},
        ${input.startedAt}, ${input.completedAt}, ${JSON.stringify({ startedAt: input.startedAt })})
    `;
    yield* sql`
      INSERT INTO orchestration_v2_projection_run_attempts
        (attempt_id, thread_id, run_id, attempt_ordinal, root_node_id, provider,
         provider_thread_id, status, payload_json)
      VALUES (${`${input.runId}:attempt`}, ${input.threadId}, ${input.runId}, 1, 'node',
        'claudeAgent', ${`${input.threadId}:pt`}, 'completed', '{}')
    `;
    yield* sql`
      INSERT INTO orchestration_v2_projection_provider_turns
        (provider_turn_id, thread_id, provider_thread_id, node_id, run_attempt_id, ordinal,
         status, started_at, completed_at, payload_json)
      VALUES (${`${input.runId}:turn`}, ${input.threadId}, ${`${input.threadId}:pt`}, 'node',
        ${`${input.runId}:attempt`}, ${input.ordinal}, ${status}, ${input.startedAt},
        ${input.completedAt}, ${JSON.stringify(input.reported === false ? {} : usage(100))})
    `;
  });

const item = (input: {
  readonly threadId: string;
  readonly id: string;
  readonly type: string;
  readonly runId?: string;
  readonly providerTurnId?: string;
  readonly status?: string;
  readonly startedAt?: string;
  readonly completedAt?: string;
}) =>
  Effect.flatMap(SqlClient.SqlClient, (sql) => {
    const startedAt = input.startedAt ?? "2026-01-02T00:00:00.000Z";
    const completedAt = input.completedAt ?? "2026-01-02T00:00:01.000Z";
    const status = input.status ?? "completed";
    return sql`
      INSERT INTO orchestration_v2_projection_turn_items
        (turn_item_id, thread_id, run_id, provider_turn_id, ordinal, type, status, updated_at,
         payload_json)
      VALUES (${input.id}, ${input.threadId}, ${input.runId ?? null},
        ${input.providerTurnId ?? null}, 1, ${input.type}, ${status}, ${completedAt},
        ${JSON.stringify(status === "completed" ? { startedAt, completedAt } : { startedAt })})
    `;
  });

const thread = (id: string, lineage: object, deletedAt: string | null = null) =>
  Effect.flatMap(
    SqlClient.SqlClient,
    (sql) => sql`
      INSERT INTO orchestration_v2_projection_threads
        (thread_id, project_id, title, default_provider, runtime_mode, interaction_mode,
         created_at, updated_at, deleted_at, payload_json)
      VALUES (${id}, ${PROJECT}, ${id}, 'claudeAgent', 'full-access', 'default',
        '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', ${deletedAt},
        ${JSON.stringify({ lineage })})
    `,
  );

const subagentOf = (parentThreadId: ThreadId) => ({
  parentThreadId,
  relationshipToParent: "subagent",
  rootThreadId: ROOT,
});

const seed = Effect.gen(function* () {
  const root = { parentThreadId: null, relationshipToParent: null, rootThreadId: ROOT };
  yield* thread(ROOT, root);
  yield* thread(CHILD, subagentOf(ROOT));
  yield* thread(LATE_CHILD, subagentOf(ROOT));
  yield* thread(FORK, { parentThreadId: ROOT, relationshipToParent: "fork", rootThreadId: ROOT });
  yield* thread(DELETED, root, "2026-01-03T00:00:00.000Z");

  // Provider rows hold instance ids; the driver column is what labels a provider.
  yield* providerThread(ROOT, "claude_work", "claudeAgent");
  yield* providerThread(LATE_CHILD, "cursor_work", "cursor");
  yield* providerThread(FORK, "codex_personal", "codex");
  yield* providerThread(DELETED, "claude_work", "claudeAgent");

  yield* run({
    threadId: ROOT,
    runId: "root-run-1",
    ordinal: 1,
    startedAt: "2026-01-02T00:00:00.000Z",
    completedAt: "2026-01-02T00:00:10.000Z",
  });
  yield* item({ threadId: ROOT, runId: "root-run-1", id: "root-item", type: "command_execution" });
  // Still running, so not counted yet.
  yield* run({
    threadId: ROOT,
    runId: "root-run-2",
    ordinal: 2,
    startedAt: "2026-01-05T00:00:00.000Z",
    completedAt: null,
  });
  // A run-less subagent thread, as Claude's native subagents are.
  yield* item({ threadId: CHILD, id: "child-item", type: "file_change" });
  // A run-less child with its own provider turn, finishing inside the root's running turn.
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    INSERT INTO orchestration_v2_projection_provider_turns
      (provider_turn_id, thread_id, provider_thread_id, node_id, run_attempt_id, ordinal,
       status, started_at, completed_at, payload_json)
    VALUES ('late-turn', ${LATE_CHILD}, ${`${LATE_CHILD}:pt`}, 'node', NULL, 1, 'completed',
      '2026-01-05T00:00:00.000Z', '2026-01-05T00:00:03.000Z', '{}')
  `;
  yield* item({
    threadId: LATE_CHILD,
    providerTurnId: "late-turn",
    id: "late-item",
    type: "web_search",
    startedAt: "2026-01-05T00:00:00.000Z",
    completedAt: "2026-01-05T00:00:02.000Z",
  });
  yield* run({
    threadId: FORK,
    runId: "fork-run",
    ordinal: 1,
    startedAt: "2026-01-04T00:00:00.000Z",
    completedAt: "2026-01-04T00:00:05.000Z",
  });
  // Interrupted before Codex reported counts; Codex still reported for the turn before.
  yield* run({
    threadId: FORK,
    runId: "fork-run-2",
    ordinal: 2,
    startedAt: "2026-01-04T01:00:00.000Z",
    completedAt: "2026-01-04T01:00:02.000Z",
    status: "interrupted",
    reported: false,
  });
  yield* run({
    threadId: DELETED,
    runId: "deleted-run",
    ordinal: 1,
    startedAt: "2026-01-02T00:00:00.000Z",
    completedAt: "2026-01-02T00:00:05.000Z",
  });
});

const completeRootRun2 = Effect.flatMap(SqlClient.SqlClient, (sql) =>
  sql`
    UPDATE orchestration_v2_projection_runs
    SET status = 'completed', completed_at = '2026-01-05T00:00:10.000Z'
    WHERE run_id = 'root-run-2'
  `.pipe(
    Effect.andThen(sql`
      UPDATE orchestration_v2_projection_provider_turns
      SET status = 'completed', completed_at = '2026-01-05T00:00:10.000Z'
      WHERE provider_turn_id = 'root-run-2:turn'
    `),
  ),
);

const setRootUsage = (inputTokens: number) =>
  Effect.flatMap(
    SqlClient.SqlClient,
    (sql) => sql`
      UPDATE orchestration_v2_projection_provider_turns
      SET payload_json = ${JSON.stringify(usage(inputTokens))}
      WHERE provider_turn_id = 'root-run-1:turn'
    `,
  );

it.effect("adds subagent threads to their parent but keeps wall time to the thread itself", () =>
  Effect.gen(function* () {
    yield* seed;
    const service = yield* SessionStats.SessionStatsService;

    const stats = yield* service.getThreadSessionStats({ threadId: ROOT });
    assert.strictEqual(stats.threadCount, 3);
    assert.strictEqual(stats.totals.wallMs, 10_000);
    assert.deepStrictEqual(stats.totals.turns, { total: 1, reported: 1 });
    assert.strictEqual(stats.totals.tokens.uncachedInputTokens, 40);
    assert.strictEqual(stats.totals.tokens.cacheReadTokens, 60);
    assert.strictEqual(stats.totals.toolCalls.command, 1);
    assert.strictEqual(stats.totals.toolCalls.fileChange, 1);
    // The late child finished inside the root's running turn, so it waits for that turn.
    assert.strictEqual(stats.totals.toolCalls.web, 0);
    assert.deepStrictEqual(stats.totals.unreportedProviders, []);
    // The subagent's work counts as agent time beside the parent's.
    assert.strictEqual(stats.totals.agentTime.toolMs, 2_000);

    yield* completeRootRun2;
    const finished = yield* service.getThreadSessionStats({ threadId: ROOT });
    assert.strictEqual(finished.totals.toolCalls.web, 1);
    assert.deepStrictEqual(finished.totals.turns, { total: 3, reported: 2 });
    assert.deepStrictEqual(finished.totals.unreportedProviders, ["cursor"]);

    // Threads outside the family are filled in by the startup backfill.
    yield* service.start();
    const rollup = yield* service.getSessionStatsRollup({});
    assert.strictEqual(rollup.projects.length, 1);
    // Root and fork; subagent threads are part of their parent's session.
    assert.strictEqual(rollup.projects[0]?.threadCount, 2);
    // Root and fork wall time; the subagents run inside it, the deleted thread is gone.
    assert.strictEqual(rollup.totals.wallMs, 27_000);
    assert.deepStrictEqual(rollup.totals.turns, { total: 5, reported: 3 });
    // Codex reported counts for one of its turns, so its interrupted one does not flag it.
    assert.deepStrictEqual(rollup.totals.unreportedProviders, ["cursor"]);

    const windowed = yield* service.getSessionStatsRollup({ since: "2026-01-03T00:00:00Z" });
    assert.strictEqual(windowed.totals.wallMs, 17_000);
  }).pipe(Effect.provide(layerWith(Stream.empty))),
);

it.effect("recomputes a stored window when its sources change", () =>
  Effect.gen(function* () {
    yield* seed;
    const sql = yield* SqlClient.SqlClient;
    const service = yield* SessionStats.SessionStatsService;
    const read = Effect.map(
      service.getThreadSessionStats({ threadId: ROOT }),
      (stats) => stats.totals,
    );
    assert.strictEqual((yield* read).tokens.uncachedInputTokens, 40);

    // Counts can arrive after the turn ended without changing its status.
    yield* setRootUsage(200);
    assert.strictEqual((yield* read).tokens.uncachedInputTokens, 140);

    // An open wait counts up to the end of the window it began in.
    yield* sql`
      INSERT INTO orchestration_v2_projection_runtime_requests
        (runtime_request_id, thread_id, node_id, kind, status, created_at, resolved_at,
         payload_json)
      VALUES ('wait', ${ROOT}, 'node', 'approval', 'pending', '2026-01-02T00:00:05.000Z', NULL,
        '{}')
    `;
    assert.strictEqual((yield* read).wallMs, 10_000 - 5_000);
    yield* sql`
      UPDATE orchestration_v2_projection_runtime_requests
      SET status = 'resolved', resolved_at = '2026-01-02T00:00:07.000Z'
      WHERE runtime_request_id = 'wait'
    `;
    assert.strictEqual((yield* read).wallMs, 10_000 - 2_000);

    // A run-less subagent's work counts only once none of its items is still active.
    const pendingChild = ThreadId.make("pending-child");
    yield* thread(pendingChild, subagentOf(ROOT));
    yield* item({
      threadId: pendingChild,
      id: "pending-item",
      type: "subagent",
      status: "running",
    });
    assert.strictEqual((yield* read).toolCalls.subagent, 0);
    yield* sql`
      UPDATE orchestration_v2_projection_turn_items
      SET status = 'completed', updated_at = '2026-01-02T00:00:03.000Z',
        payload_json = ${JSON.stringify({
          startedAt: "2026-01-02T00:00:00.000Z",
          completedAt: "2026-01-02T00:00:03.000Z",
        })}
      WHERE turn_item_id = 'pending-item'
    `;
    assert.strictEqual((yield* read).toolCalls.subagent, 1);
  }).pipe(Effect.provide(layerWith(Stream.empty))),
);

it.effect("the follower recomputes a thread when one of its runs ends", () =>
  Effect.gen(function* () {
    const events = yield* Queue.unbounded<OrchestrationV2DomainEvent, Cause.Done>();
    const ended = yield* Deferred.make<void>();
    const program = Effect.gen(function* () {
      yield* seed;
      const service = yield* SessionStats.SessionStatsService;
      yield* service.start();
      const before = yield* service.getSessionStatsRollup({});
      assert.strictEqual(before.totals.tokens.uncachedInputTokens, 80);

      yield* setRootUsage(200);
      const now = DateTime.makeUnsafe("2026-01-02T00:00:10.000Z");
      yield* Queue.offer(events, {
        id: EventId.make("root-run-1:completed"),
        type: "run.updated",
        threadId: ROOT,
        occurredAt: now,
        payload: {
          id: RunId.make("root-run-1"),
          threadId: ROOT,
          ordinal: 1,
          providerInstanceId: ProviderInstanceId.make("claude_work"),
          modelSelection: { instanceId: ProviderInstanceId.make("claude_work"), model: "m" },
          providerThreadId: null,
          userMessageId: MessageId.make("root-run-1:prompt"),
          rootNodeId: null,
          activeAttemptId: null,
          status: "completed",
          requestedAt: now,
          startedAt: now,
          completedAt: now,
          checkpointId: null,
          contextHandoffId: null,
        },
      });
      yield* Queue.end(events);
      yield* Deferred.await(ended);
      yield* service.drain;

      const after = yield* service.getSessionStatsRollup({});
      assert.strictEqual(after.totals.tokens.uncachedInputTokens, 180);
    });
    yield* program.pipe(
      Effect.provide(
        layerWith(Stream.fromQueue(events).pipe(Stream.onEnd(Deferred.succeed(ended, undefined)))),
      ),
    );
  }),
);

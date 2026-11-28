import { assert, describe, it } from "@effect/vitest";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

import { migrationManifest, runMigrations } from "../persistence/Migrations.ts";
import { ensureSessionStatsSchema } from "./sessionStatsSchema.ts";

const TABLE = "orchestration_v2_session_stats_windows";

describe("session stats schema", () => {
  it.effect("stays out of the migration ledger", () =>
    Effect.sync(() => {
      assert.isFalse(migrationManifest.some(([, name]) => name.includes("SessionStats")));
    }),
  );

  it.effect("creates the table and indexes, and keeps rows on a second run", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations();
      yield* ensureSessionStatsSchema;
      yield* sql`
        INSERT INTO orchestration_v2_session_stats_windows
          (window_id, thread_id, top_level, completed_at, source_key, stats_json)
        VALUES ('w1', 't1', 1, '2026-11-21T00:00:00.000Z', 'k1', '{}')
      `;
      // A database a ledger-migration build already created the table in.
      yield* ensureSessionStatsSchema;

      const indexes = yield* sql<{ readonly name: string }>`
        SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = ${TABLE} ORDER BY name
      `;
      assert.deepStrictEqual(
        indexes.map((row) => row.name).filter((name) => !name.startsWith("sqlite_")),
        [
          "orchestration_v2_session_stats_windows_completed_idx",
          "orchestration_v2_session_stats_windows_thread_idx",
        ],
      );
      const rows = yield* sql<{ readonly windowId: string }>`
        SELECT window_id AS "windowId" FROM orchestration_v2_session_stats_windows
      `;
      assert.deepStrictEqual(
        rows.map((row) => row.windowId),
        ["w1"],
      );
    }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
  );
});

import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

/**
 * Creates the session stats table when it is missing.
 *
 * The table lives outside the numbered migration ledger on purpose: this feature is carried on a
 * fork branch, and a ledger id it claims would sooner or later collide with an upstream migration
 * (the migrator skips every id up to the highest recorded one, whatever its name). Every row is
 * derived from thread history and recomputed when its `source_key` changes, so a schema change can
 * drop and rebuild the table here instead of migrating it.
 */
export const ensureSessionStatsSchema = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  // One row per finished turn window; SessionStatsService recomputes a row when its source_key
  // changes and fills in rows for existing threads at startup.
  yield* sql`
    CREATE TABLE IF NOT EXISTS orchestration_v2_session_stats_windows (
      window_id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      top_level INTEGER NOT NULL,
      completed_at TEXT NOT NULL,
      source_key TEXT NOT NULL,
      stats_json TEXT NOT NULL
    )
  `;
  yield* sql`
    CREATE INDEX IF NOT EXISTS orchestration_v2_session_stats_windows_thread_idx
    ON orchestration_v2_session_stats_windows(thread_id)
  `;
  yield* sql`
    CREATE INDEX IF NOT EXISTS orchestration_v2_session_stats_windows_completed_idx
    ON orchestration_v2_session_stats_windows(completed_at)
  `;
});

import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  sessionStatsAgentTimeHint,
  sessionStatsAgentTimeMs,
  sessionStatsNotes,
  sessionStatsToolCallCount,
  sessionStatsToolRows,
  sessionStatsWallTimeHint,
} from "@t3tools/client-runtime/session-stats";
import { formatWorkingDurationLabel } from "@t3tools/client-runtime/state/models";
import {
  sessionStatsTotalTokens,
  type EnvironmentId,
  type SessionStatsTotals,
  type ThreadId,
  type ThreadSessionStats as ThreadSessionStatsData,
} from "@t3tools/contracts";
import { formatDuration } from "@t3tools/shared/orchestrationTiming";
import { formatCount, formatTokens } from "@t3tools/shared/usageFormat";
import { T, useGT, useMessages } from "gt-react";

import { useNowSecond } from "../../hooks/useNowSecond";
import { orchestrationEnvironment } from "../../state/orchestration";
import { useQuietThreadShell } from "../../state/entities";
import { useEnvironmentQuery } from "../../state/query";
import { sessionStatsTimeSegments, sessionStatsTokenSegments } from "../usage/usageBreakdown";
import { SessionStatsTokenNotes } from "../usage/UsageSessionStats";
import { HintLabel, UsageShareBar } from "../usage/UsageShareBar";
import { ThreadDetailsSection } from "./ThreadDetailsSection";

interface ThreadSessionStatsProps {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
}

/** Tokens, time and tool calls of the thread's finished turns, with its subagents. */
export function ThreadSessionStats(props: ThreadSessionStatsProps) {
  const gt = useGT();
  const shell = useQuietThreadShell(scopeThreadRef(props.environmentId, props.threadId));
  const query = useEnvironmentQuery<ThreadSessionStatsData, unknown>(
    orchestrationEnvironment.threadSessionStats({
      environmentId: props.environmentId,
      input: { threadId: props.threadId },
    }),
  );
  const latestRun = shell?.latestRun ?? null;
  const runningSince =
    latestRun?.completedAt == null && latestRun?.startedAt != null
      ? Date.parse(latestRun.startedAt)
      : null;
  const totals = query.data?.totals;

  return (
    <ThreadDetailsSection
      headingId="thread-details-session-stats-heading"
      title={gt("Session stats")}
    >
      <div className="flex flex-col gap-4 px-2.5 text-xs">
        {query.error !== null && totals === undefined ? (
          <p className="text-destructive-foreground">{query.error}</p>
        ) : totals === undefined ? (
          <p className="text-muted-foreground">
            <T>Loading…</T>
          </p>
        ) : (
          <SessionStatsBody
            totals={totals}
            threadCount={query.data?.threadCount ?? 1}
            runningSince={runningSince}
          />
        )}
      </div>
    </ThreadDetailsSection>
  );
}

function SessionStatsBody(props: {
  readonly totals: SessionStatsTotals;
  readonly threadCount: number;
  readonly runningSince: number | null;
}) {
  const gt = useGT();
  const m = useMessages();
  const { totals } = props;
  const { tokens } = totals;
  const tools = sessionStatsToolRows(totals);
  const notes = sessionStatsNotes(totals, m);
  const totalTokens = sessionStatsTotalTokens(totals);
  return (
    <>
      <div className="flex flex-col gap-0.5">
        <p className="text-muted-foreground">
          <HintLabel hint={sessionStatsWallTimeHint(m)}>
            <T>Wall time</T>
          </HintLabel>
        </p>
        <p className="text-base font-medium tabular-nums text-foreground">
          {formatDuration(totals.wallMs)}
          {props.runningSince !== null ? <RunningElapsed since={props.runningSince} /> : null}
        </p>
        {props.threadCount > 1 ? (
          <p className="text-muted-foreground">
            {gt(
              "{count, plural, one {Includes {count} subagent thread.} other {Includes {count} subagent threads.}}",
              { count: props.threadCount - 1 },
            )}
          </p>
        ) : null}
      </div>

      <UsageShareBar
        label={gt("Agent time")}
        hint={sessionStatsAgentTimeHint(m)}
        segments={sessionStatsTimeSegments(totals)}
        format={formatDuration}
        aside={
          <span className="tabular-nums text-muted-foreground">
            {formatDuration(sessionStatsAgentTimeMs(totals))}
          </span>
        }
      />

      {totalTokens > 0 ? (
        <div className="flex flex-col gap-1.5">
          <UsageShareBar
            label={gt("Tokens by type")}
            segments={sessionStatsTokenSegments(tokens)}
            format={formatTokens}
            aside={
              <span className="tabular-nums text-muted-foreground">
                {formatTokens(totalTokens)}
              </span>
            }
          />
          <SessionStatsTokenNotes tokens={tokens} />
        </div>
      ) : (
        <p className="text-muted-foreground">
          <T>No token counts yet.</T>
        </p>
      )}

      {tools.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-baseline justify-between gap-3">
            <h3 className="text-sm font-medium text-foreground">
              <T>Tool calls</T>
            </h3>
            <span className="tabular-nums text-muted-foreground">
              {formatCount(sessionStatsToolCallCount(totals))}
            </span>
          </div>
          <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5">
            {tools.map((row) => (
              <div key={row.label} className="contents">
                <dt className="text-muted-foreground">{m(row.label)}</dt>
                <dd className="text-right tabular-nums text-foreground">
                  {formatCount(row.value)}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      ) : null}

      {notes.length > 0 ? (
        <ul className="flex flex-col gap-0.5 text-muted-foreground">
          {notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      ) : null}
    </>
  );
}

// Self-ticking so only this span re-renders each second.
function RunningElapsed(props: { readonly since: number }) {
  const gt = useGT();
  const m = useMessages();
  const now = useNowSecond();
  return (
    <span className="font-normal text-muted-foreground">
      {" "}
      {gt("+ {elapsed} running", { elapsed: formatWorkingDurationLabel(now - props.since, m) })}
    </span>
  );
}

import {
  combineSessionStatsTotals,
  sessionStatsAgentTimeHint,
  sessionStatsAgentTimeMs,
  sessionStatsMissingEnvironmentsNote,
  sessionStatsNotes,
  sessionStatsRange,
  sessionStatsToolCallCount,
  sessionStatsWallTimeHint,
} from "@t3tools/client-runtime/session-stats";
import {
  sessionStatsTotalTokens,
  type EnvironmentId,
  type SessionStatsProjectRollup,
  type SessionStatsTokens,
  type SessionStatsTotals,
  type UsageSummaryInput,
} from "@t3tools/contracts";
import { formatDuration } from "@t3tools/shared/orchestrationTiming";
import { formatCount, formatTokens } from "@t3tools/shared/usageFormat";
import { T, useGT, useMessages, Var } from "gt-react";

import { useSessionStatsByEnvironment } from "../../state/sessionStats";
import { sessionStatsTokenSegments } from "./usageBreakdown";
import { HintLabel, UsageShareBar } from "./UsageShareBar";

/** Session stats of this environment's threads, by project, for the page's window. */
export function UsageSessionStats(props: {
  readonly window: UsageSummaryInput;
  readonly environmentIds: ReadonlyArray<EnvironmentId>;
}) {
  const gt = useGT();
  const m = useMessages();
  const selected = useSessionStatsByEnvironment({
    ...sessionStatsRange(props.window),
    environmentIds: props.environmentIds,
  });
  const answered = selected.flatMap((entry) =>
    entry.rollup === null ? [] : [{ ...entry, rollup: entry.rollup }],
  );
  const missing = selected.filter((entry) => entry.unavailable).length;
  const pending = selected.some((entry) => entry.isPending && entry.rollup === null);
  const totals = combineSessionStatsTotals(answered.map((entry) => entry.rollup));
  const missingNote = sessionStatsMissingEnvironmentsNote(missing, m);
  const notes = [...sessionStatsNotes(totals, m), ...(missingNote === null ? [] : [missingNote])];

  return (
    <section aria-labelledby="usage-session-stats-heading" className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="usage-session-stats-heading" className="text-sm font-medium text-foreground">
          <T>Session stats by project</T>
        </h2>
        {answered.length > 1 ? (
          <span className="text-xs text-muted-foreground">
            <T>All environments</T>
          </span>
        ) : null}
      </div>
      {pending && answered.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          <T>Loading…</T>
        </p>
      ) : answered.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          <T>No session stats for this window.</T>
        </p>
      ) : (
        <>
          <TotalsLine totals={totals} />
          {sessionStatsTotalTokens(totals) > 0 ? (
            <div className="flex flex-col gap-1.5 text-xs">
              <UsageShareBar
                label={gt("Tokens by type")}
                segments={sessionStatsTokenSegments(totals.tokens)}
                format={formatTokens}
              />
              <SessionStatsTokenNotes tokens={totals.tokens} />
            </div>
          ) : null}
          {answered.map((entry) => (
            <div key={entry.environmentId} className="flex flex-col gap-2">
              {answered.length > 1 ? (
                <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <h3 className="text-sm font-medium text-foreground">{entry.label}</h3>
                  <TotalsLine totals={entry.rollup.totals} />
                </div>
              ) : null}
              <ProjectTable projects={entry.rollup.projects} />
            </div>
          ))}
        </>
      )}
      {notes.length > 0 ? (
        <ul className="flex flex-col gap-0.5 text-xs text-muted-foreground">
          {notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

/** What the token bar leaves out: reasoning inside output, and input/output-only figures. */
export function SessionStatsTokenNotes({ tokens }: { readonly tokens: SessionStatsTokens }) {
  return (
    <>
      {tokens.reasoningTokens > 0 ? (
        <p className="text-muted-foreground">
          <T>
            Output includes <Var>{formatTokens(tokens.reasoningTokens)}</Var> reasoning.
          </T>
        </p>
      ) : null}
      {tokens.otherInputTokens + tokens.otherOutputTokens > 0 ? (
        <p className="text-muted-foreground">
          <T>
            Subagents & compaction (input/output only):{" "}
            <span className="tabular-nums text-foreground">
              <Var>{formatTokens(tokens.otherInputTokens)}</Var> in ·{" "}
              <Var>{formatTokens(tokens.otherOutputTokens)}</Var> out
            </span>
          </T>
        </p>
      ) : null}
    </>
  );
}

function TotalsLine({ totals }: { readonly totals: SessionStatsTotals }) {
  return (
    <p className="text-xs text-muted-foreground tabular-nums">
      <T>
        <span className="text-foreground">
          <Var>{formatTokens(sessionStatsTotalTokens(totals))}</Var>
        </span>{" "}
        tokens ·{" "}
        <span className="text-foreground">
          <Var>{formatDuration(totals.wallMs)}</Var>
        </span>{" "}
        wall ·{" "}
        <span className="text-foreground">
          <Var>{formatDuration(sessionStatsAgentTimeMs(totals))}</Var>
        </span>{" "}
        agent time ·{" "}
        <span className="text-foreground">
          <Var>{formatCount(sessionStatsToolCallCount(totals))}</Var>
        </span>{" "}
        tool calls
      </T>
    </p>
  );
}

function ProjectTable({
  projects,
}: {
  readonly projects: ReadonlyArray<SessionStatsProjectRollup>;
}) {
  const m = useMessages();
  if (projects.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        <T>No finished turns in this window.</T>
      </p>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-md text-xs">
        <thead className="text-muted-foreground">
          <tr className="text-left">
            <th className="py-1 pe-3 font-normal">
              <T>Project</T>
            </th>
            <th className="py-1 pe-3 text-right font-normal">
              <T>Threads</T>
            </th>
            <th className="py-1 pe-3 text-right font-normal">
              <T>Tokens</T>
            </th>
            <th className="py-1 pe-3 text-right font-normal">
              <HintLabel hint={sessionStatsWallTimeHint(m)}>
                <T context="wall-clock time">Wall</T>
              </HintLabel>
            </th>
            <th className="py-1 pe-3 text-right font-normal">
              <HintLabel hint={sessionStatsAgentTimeHint(m)}>
                <T>Agent time</T>
              </HintLabel>
            </th>
            <th className="py-1 text-right font-normal">
              <T>Tool calls</T>
            </th>
          </tr>
        </thead>
        <tbody className="tabular-nums">
          {projects.map((project) => (
            <tr key={project.projectId} className="border-t border-border/65">
              <td className="max-w-48 truncate py-1 pe-3 text-foreground">
                {project.title || project.projectId}
              </td>
              <td className="py-1 pe-3 text-right">{formatCount(project.threadCount)}</td>
              <td className="py-1 pe-3 text-right">
                {formatTokens(sessionStatsTotalTokens(project.totals))}
              </td>
              <td className="py-1 pe-3 text-right">{formatDuration(project.totals.wallMs)}</td>
              <td className="py-1 pe-3 text-right">
                {formatDuration(sessionStatsAgentTimeMs(project.totals))}
              </td>
              <td className="py-1 text-right">
                {formatCount(sessionStatsToolCallCount(project.totals))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

import {
  combineSessionStatsTotals,
  sessionStatsAgentTimeMs,
  sessionStatsMissingEnvironmentsNote,
  sessionStatsRange,
  sessionStatsToolCallCount,
} from "@t3tools/client-runtime/session-stats";
import {
  sessionStatsTotalTokens,
  type EnvironmentId,
  type SessionStatsProjectRollup,
  type SessionStatsTotals,
  type UsageSummaryInput,
} from "@t3tools/contracts";
import { formatDuration } from "@t3tools/shared/orchestrationTiming";
import { formatCount, formatTokens } from "@t3tools/shared/usageFormat";
import { T, useGT, useMessages, Var } from "gt-react-native";
import { View } from "react-native";

import { AppText as Text } from "../../components/ui/AppText";
import { useSessionStatsByEnvironment } from "../../state/sessionStats";
import { SettingsSection } from "../settings/components/SettingsSection";
import { SessionStatsSummary } from "./SessionStatsSummary";

/** Session stats of each environment's threads, by project, for the screen's window. */
export function UsageSessionStatsSection(props: {
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
  if (answered.length === 0 && missing === 0) return null;
  const totals = combineSessionStatsTotals(answered.map((entry) => entry.rollup));
  const missingNote = sessionStatsMissingEnvironmentsNote(missing, m);

  return (
    <SettingsSection
      title={answered.length > 1 ? gt("Session stats · all environments") : gt("Session stats")}
    >
      <SessionStatsSummary totals={totals} extraNotes={missingNote === null ? [] : [missingNote]} />
      {answered.map((entry) => (
        <View key={entry.environmentId} className="border-t border-border-subtle p-4 gap-2">
          {answered.length > 1 ? (
            <View className="gap-0.5">
              <Text className="text-sm font-t3-medium text-foreground">{entry.label}</Text>
              <Text className="text-xs tabular-nums text-foreground-muted">
                <TotalsLine totals={entry.rollup.totals} />
              </Text>
            </View>
          ) : null}
          {entry.rollup.projects.length === 0 ? (
            <Text className="text-sm text-foreground-muted">
              <T>No finished turns in this window.</T>
            </Text>
          ) : (
            entry.rollup.projects.map((project) => (
              <ProjectRow key={project.projectId} project={project} />
            ))
          )}
        </View>
      ))}
    </SettingsSection>
  );
}

function TotalsLine(props: { readonly totals: SessionStatsTotals }) {
  const { totals } = props;
  return (
    <T>
      <Var>{formatTokens(sessionStatsTotalTokens(totals))}</Var> tokens ·{" "}
      <Var>{formatDuration(totals.wallMs)}</Var> wall ·{" "}
      <Var>{formatDuration(sessionStatsAgentTimeMs(totals))}</Var> agent time ·{" "}
      <Var>{formatCount(sessionStatsToolCallCount(totals))}</Var> tool calls
    </T>
  );
}

function ProjectRow(props: { readonly project: SessionStatsProjectRollup }) {
  const gt = useGT();
  const { project } = props;
  return (
    <View className="gap-0.5">
      <View className="flex-row justify-between gap-3">
        <Text className="shrink text-sm text-foreground" numberOfLines={1}>
          {project.title || project.projectId}
        </Text>
        <Text className="text-sm tabular-nums text-foreground">
          {formatTokens(sessionStatsTotalTokens(project.totals))}
        </Text>
      </View>
      <Text className="text-xs tabular-nums text-foreground-muted">
        {gt(
          "{count, plural, one {{count} thread} other {{count} threads}} · {wall} wall · {agent} agent · {tools} tool calls",
          {
            count: project.threadCount,
            wall: formatDuration(project.totals.wallMs),
            agent: formatDuration(sessionStatsAgentTimeMs(project.totals)),
            tools: formatCount(sessionStatsToolCallCount(project.totals)),
          },
        )}
      </Text>
    </View>
  );
}

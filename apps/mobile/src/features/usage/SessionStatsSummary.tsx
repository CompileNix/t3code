import {
  sessionStatsAgentTimeHint,
  sessionStatsAgentTimeMs,
  sessionStatsNotes,
  sessionStatsTimeRows,
  sessionStatsToolCallCount,
  sessionStatsToolRows,
  sessionStatsWallTimeHint,
} from "@t3tools/client-runtime/session-stats";
import { formatWorkingDurationLabel } from "@t3tools/client-runtime/state/models";
import { sessionStatsTotalTokens, type SessionStatsTotals } from "@t3tools/contracts";
import { formatDuration } from "@t3tools/shared/orchestrationTiming";
import { formatCount, formatTokens } from "@t3tools/shared/usageFormat";
import { T, useGT, useMessages, Var } from "gt-react-native";
import { View } from "react-native";

import { AppText as Text } from "../../components/ui/AppText";
import { useVisibleSecondClock } from "../threads/use-visible-second-clock";
import { useUsageMixColors } from "./usageProviders";
import { HintLabel, UsageShareBar } from "./UsageShareBar";

/** Tokens by type, agent time by phase and tool calls by category, as on web. */
export function SessionStatsSummary(props: {
  readonly totals: SessionStatsTotals;
  /** The thread's own subagent and delegated-task threads, when showing one thread. */
  readonly subagentThreads?: number;
  readonly runningSince?: number | null;
  readonly extraNotes?: ReadonlyArray<string>;
}) {
  const gt = useGT();
  const m = useMessages();
  const { totals } = props;
  const { tokens } = totals;
  const colors = useUsageMixColors();
  const totalTokens = sessionStatsTotalTokens(totals);
  const timeColors = [colors.other, colors.output, colors.cacheWrite, colors.cacheRead];
  const tools = sessionStatsToolRows(totals);
  const notes = [...sessionStatsNotes(totals, m), ...(props.extraNotes ?? [])];

  return (
    <View>
      <View className="gap-0.5 px-4 pt-4">
        <HintLabel hint={sessionStatsWallTimeHint(m)} className="text-sm text-foreground-muted">
          <T>Wall time</T>
        </HintLabel>
        <Text className="text-xl font-t3-medium tabular-nums text-foreground">
          {formatDuration(totals.wallMs)}
          {props.runningSince != null ? <RunningElapsed since={props.runningSince} /> : null}
        </Text>
        {props.subagentThreads ? (
          <Text className="text-xs text-foreground-muted">
            {gt(
              "{count, plural, one {Includes {count} subagent thread.} other {Includes {count} subagent threads.}}",
              { count: props.subagentThreads },
            )}
          </Text>
        ) : null}
      </View>

      <UsageShareBar
        label={gt("Agent time")}
        hint={sessionStatsAgentTimeHint(m)}
        aside={formatDuration(sessionStatsAgentTimeMs(totals))}
        format={formatDuration}
        segments={sessionStatsTimeRows(totals).map((row, index) => ({
          label: m(row.label),
          value: row.value,
          color: timeColors[index] ?? colors.other,
        }))}
      />

      {totalTokens > 0 ? (
        <UsageShareBar
          label={gt("Tokens by type")}
          aside={formatTokens(totalTokens)}
          format={formatTokens}
          segments={[
            {
              label: gt("Input", { $context: "input tokens" }),
              value: tokens.uncachedInputTokens,
              color: colors.input,
            },
            { label: gt("Cache read"), value: tokens.cacheReadTokens, color: colors.cacheRead },
            { label: gt("Cache write"), value: tokens.cacheWriteTokens, color: colors.cacheWrite },
            {
              label: gt("Output", { $context: "output tokens" }),
              value: tokens.outputTokens,
              color: colors.output,
            },
          ]}
        />
      ) : (
        <Text className="p-4 text-sm text-foreground-muted">
          <T>No token counts yet.</T>
        </Text>
      )}
      <View className="gap-1 px-4">
        {tokens.reasoningTokens > 0 ? (
          <Text className="text-xs text-foreground-muted">
            <T>
              Output includes <Var>{formatTokens(tokens.reasoningTokens)}</Var> reasoning.
            </T>
          </Text>
        ) : null}
        {tokens.otherInputTokens + tokens.otherOutputTokens > 0 ? (
          <Text className="text-xs text-foreground-muted">
            <T>
              Subagents & compaction (input/output only):{" "}
              <Var>{formatTokens(tokens.otherInputTokens)}</Var> in ·{" "}
              <Var>{formatTokens(tokens.otherOutputTokens)}</Var> out
            </T>
          </Text>
        ) : null}
      </View>

      {tools.length > 0 ? (
        <View className="gap-1.5 p-4">
          <View className="flex-row items-baseline justify-between gap-3">
            <Text className="text-sm text-foreground-muted">
              <T>Tool calls</T>
            </Text>
            <Text className="text-sm tabular-nums text-foreground-muted">
              {formatCount(sessionStatsToolCallCount(totals))}
            </Text>
          </View>
          {tools.map((row) => (
            <View key={row.label} className="flex-row justify-between gap-3">
              <Text className="text-sm text-foreground-muted">{m(row.label)}</Text>
              <Text className="text-sm tabular-nums text-foreground">{formatCount(row.value)}</Text>
            </View>
          ))}
        </View>
      ) : null}

      {notes.length > 0 ? (
        <View className="gap-0.5 px-4 pb-4">
          {notes.map((note) => (
            <Text key={note} className="text-xs text-foreground-muted">
              {note}
            </Text>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function RunningElapsed(props: { readonly since: number }) {
  const gt = useGT();
  const m = useMessages();
  const now = useVisibleSecondClock(true);
  return (
    <Text className="text-sm font-sans text-foreground-muted">
      {" "}
      {gt("+ {elapsed} running", { elapsed: formatWorkingDurationLabel(now - props.since, m) })}
    </Text>
  );
}

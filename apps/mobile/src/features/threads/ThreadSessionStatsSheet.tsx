import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentId, ThreadId, ThreadSessionStats } from "@t3tools/contracts";
import { T, useGT } from "gt-react-native";
import { ScrollView } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText as Text } from "../../components/ui/AppText";
import { Sheet } from "../../components/ui/Sheet";
import { useQuietThreadShell } from "../../state/entities";
import { orchestrationEnvironment } from "../../state/orchestration";
import { useEnvironmentQuery } from "../../state/query";
import { SessionStatsSummary } from "../usage/SessionStatsSummary";

/** The thread's session stats, with its subagents. Mount only while open. */
export function ThreadSessionStatsSheet(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly onClose: () => void;
}) {
  const gt = useGT();
  const insets = useSafeAreaInsets();
  const shell = useQuietThreadShell(scopeThreadRef(props.environmentId, props.threadId));
  const query = useEnvironmentQuery<ThreadSessionStats, unknown>(
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

  return (
    <Sheet title={gt("Session stats")} onClose={props.onClose}>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ paddingBottom: Math.max(20, insets.bottom) }}
      >
        {query.data !== null ? (
          <SessionStatsSummary
            totals={query.data.totals}
            subagentThreads={query.data.threadCount - 1}
            runningSince={runningSince}
          />
        ) : query.error !== null ? (
          <Text selectable className="p-4 font-sans text-sm text-danger-foreground">
            {query.error}
          </Text>
        ) : (
          <Text className="p-4 font-sans text-sm text-foreground-secondary">
            <T>Loading…</T>
          </Text>
        )}
      </ScrollView>
    </Sheet>
  );
}

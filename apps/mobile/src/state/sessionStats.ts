import { useAtomValue } from "@effect/atom-react";
import {
  createSessionStatsByRangeAtomFamily,
  refreshSessionStatsRollups,
  type EnvironmentSessionStats,
  type SessionStatsSelection,
} from "@t3tools/client-runtime/state/session-stats";

import { appAtomRegistry } from "./atom-registry";
import { orchestrationEnvironment } from "./orchestration";
import { environmentPresentations } from "./presentation";

const sessionStatsByRangeAtom = createSessionStatsByRangeAtomFamily({
  label: "mobile-session-stats:range",
  presentationsAtom: environmentPresentations.presentationsAtom,
  rollup: orchestrationEnvironment.sessionStatsRollup,
});

export function useSessionStatsByEnvironment(
  selection: SessionStatsSelection,
): ReadonlyArray<EnvironmentSessionStats> {
  return useAtomValue(sessionStatsByRangeAtom(JSON.stringify(selection)));
}

export function refreshSessionStats(selection: SessionStatsSelection): void {
  refreshSessionStatsRollups({
    registry: appAtomRegistry,
    rollup: orchestrationEnvironment.sessionStatsRollup,
    selection,
  });
}

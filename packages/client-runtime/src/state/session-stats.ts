import type { EnvironmentId, SessionStatsRollup } from "@t3tools/contracts";
import { AsyncResult, Atom, type AtomRegistry } from "effect/reactivity";

import type { EnvironmentPresentation } from "../connection/index.ts";

export interface EnvironmentSessionStats {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly isPending: boolean;
  /** Offline, or a server that predates session stats. */
  readonly unavailable: boolean;
  readonly rollup: SessionStatsRollup | null;
}

export interface SessionStatsSelection {
  readonly since: string;
  readonly until: string;
  readonly environmentIds: ReadonlyArray<EnvironmentId>;
}

type RollupAtom = (target: {
  readonly environmentId: EnvironmentId;
  readonly input: { readonly since: string; readonly until: string };
}) => Atom.Atom<AsyncResult.AsyncResult<SessionStatsRollup, unknown>>;

/** The selected environments' session stats rollups for one range, keyed as JSON. */
export function createSessionStatsByRangeAtomFamily(options: {
  readonly label: string;
  readonly presentationsAtom: Atom.Atom<ReadonlyMap<EnvironmentId, EnvironmentPresentation>>;
  readonly rollup: RollupAtom;
}) {
  return Atom.family((selectionKey: string) =>
    Atom.make((get): ReadonlyArray<EnvironmentSessionStats> => {
      const { since, until, environmentIds } = JSON.parse(selectionKey) as SessionStatsSelection;
      const selected = new Set(environmentIds);
      return [...get(options.presentationsAtom)].flatMap(([environmentId, presentation]) => {
        if (!selected.has(environmentId)) return [];
        const label = presentation.entry.target.label;
        if (presentation.connection.phase !== "connected") {
          return [{ environmentId, label, isPending: false, unavailable: true, rollup: null }];
        }
        const result = get(options.rollup({ environmentId, input: { since, until } }));
        return [
          {
            environmentId,
            label,
            isPending: result.waiting,
            unavailable: result._tag === "Failure",
            rollup: AsyncResult.getOrElse(result, () => null),
          },
        ];
      });
    }).pipe(Atom.withLabel(`${options.label}:${selectionKey}`)),
  );
}

export function refreshSessionStatsRollups(options: {
  readonly registry: AtomRegistry.AtomRegistry;
  readonly rollup: RollupAtom;
  readonly selection: SessionStatsSelection;
}): void {
  const { since, until, environmentIds } = options.selection;
  for (const environmentId of environmentIds) {
    options.registry.refresh(options.rollup({ environmentId, input: { since, until } }));
  }
}

/**
 * WhatIfPanel.tsx: the What if tab.
 *
 * The map stays at the top and redraws as the limits change, with a line under it saying what moved. Below it
 * are the limits (sliders and switches), the chat, which limit matters most, what would help, and saved
 * scenarios. The panel is a function of its props: all state and every network call live in PathApp.
 */
"use client";
import type { ExploreResult } from "../lib/api/handlers";
import type { Constraints } from "../lib/schemas";
import type { Relaxation } from "../lib/whatif";
import type { Turn } from "../ui/chat";
import { deltaChips } from "../ui/delta";
import { ARCHETYPE_LABEL, summaryLine, type Archetype } from "../ui/format";
import { axisMaxFor } from "../ui/mapLayout";
import { ROLE_LABEL, type Person } from "../ui/sample";
import type { Scenario } from "../ui/scenarios";
import { Chat } from "./Chat";
import { Constellation } from "./Constellation";
import { Controls } from "./Controls";
import { DeltaChips, TornadoPanel, WhatItTakePanel } from "./Insights";
import { RouteCard } from "./RouteCard";
import { Scenarios } from "./Scenarios";

/** Everything the What if tab needs from the app, besides the person and the numbers. */
export interface WhatIfBindings {
  /** The numbers at the starting limits, for "what changed". Undefined until the first answer arrives. */
  baseline: ExploreResult | undefined;
  /** True when the limits are not the starting ones. */
  changed: boolean;
  /** True while new numbers are on their way (the old ones stay on screen meanwhile). */
  refreshing: boolean;
  turns: readonly Turn[];
  chatBusy: boolean;
  scenarios: readonly Scenario[];
  scenarioNotice: string | undefined;
  onChange: (next: Constraints) => void;
  onReset: () => void;
  onSend: (text: string) => void;
  onApply: (relaxation: Relaxation) => void;
  onSaveScenario: () => void;
  onOpenScenario: (id: string) => void;
  onRemoveScenario: (id: string) => void;
  onRenameScenario: (id: string, name: string) => void;
}

/** Bindings for a screen that is not interactive yet, such as a static render. */
export const IDLE_BINDINGS: WhatIfBindings = {
  baseline: undefined,
  changed: false,
  refreshing: false,
  turns: [],
  chatBusy: false,
  scenarios: [],
  scenarioNotice: undefined,
  onChange: () => undefined,
  onReset: () => undefined,
  onSend: () => undefined,
  onApply: () => undefined,
  onSaveScenario: () => undefined,
  onOpenScenario: () => undefined,
  onRemoveScenario: () => undefined,
  onRenameScenario: () => undefined,
};

export interface WhatIfPanelProps {
  person: Person;
  data: ExploreResult;
  selected: Archetype;
  onSelect: (archetype: Archetype) => void;
  bindings: WhatIfBindings;
}

export function WhatIfPanel({ person, data, selected, onSelect, bindings: b }: WhatIfPanelProps) {
  const maxMonths = person.constraints.maxMonths;
  const route = data.routes.find((r) => r.archetype === selected) ?? data.routes[0];
  const chips = b.baseline ? deltaChips(b.baseline, data) : [];
  const axisMax = axisMaxFor(data.routes, maxMonths);
  return (
    <div
      className={`whatif${b.refreshing ? " whatif--refreshing" : ""}`}
      aria-busy={b.refreshing || undefined}
    >
      <Constellation
        routes={data.routes}
        maxMonths={maxMonths}
        selected={selected}
        onSelect={onSelect}
        goalLabel={person.goal.label}
        youLabel={`${ROLE_LABEL[person.profile.roleFamily]} \u00b7 ${person.profile.level}`}
      />
      {route && (
        <p className="caption" aria-live="polite">
          <strong>{ARCHETYPE_LABEL[route.archetype]}:</strong> {summaryLine(route)}
        </p>
      )}
      {data.conflicts.length > 0 && (
        <div className="notice" role="status">
          {data.conflicts.map((c) => (
            <p key={c.message}>{c.message}</p>
          ))}
        </div>
      )}
      <DeltaChips chips={chips} startingPoint="your starting limits" />
      <div className="cards">
        {data.routes.map((r) => (
          <RouteCard
            key={r.archetype}
            route={r}
            axisMax={axisMax}
            selected={r.archetype === selected}
            recommended={data.ranking.recommended === r.archetype}
            onSelect={() => onSelect(r.archetype)}
          />
        ))}
      </div>
      <div className="whatif__grid">
        <Controls
          constraints={person.constraints}
          onChange={b.onChange}
          onReset={b.onReset}
          canReset={b.changed}
        />
        <Chat turns={b.turns} busy={b.chatBusy} onSend={b.onSend} />
      </div>
      <TornadoPanel tornado={data.tornado} />
      <WhatItTakePanel data={data.wouldItTake} onApply={b.onApply} />
      <Scenarios
        scenarios={b.scenarios}
        notice={b.scenarioNotice}
        onSave={b.onSaveScenario}
        onOpen={b.onOpenScenario}
        onRemove={b.onRemoveScenario}
        onRename={b.onRenameScenario}
      />
    </div>
  );
}

/**
 * PathApp.tsx: the screen. It asks the instant `explore` route for the numbers (no model, a few milliseconds)
 * and draws them: the map, three route cards, and the detail of the one you select. Compare and Why are tabs.
 * Parts 13 and 14 add What-if, the agent trace and the privacy panel around this same state.
 */
"use client";
import { useCallback, useEffect, useState } from "react";
import { ApiClientError, postJson } from "../lib/api/client";
import type { ExploreResult } from "../lib/api/handlers";
import { ARCHETYPE_LABEL, summaryLine, type Archetype } from "../ui/format";
import { REGION_LABEL, ROLE_LABEL, SAMPLE_PERSON, type Person } from "../ui/sample";
import { Constellation } from "./Constellation";
import { ComparePanel, RouteDetail, WhyPanel } from "./Panels";
import { RouteCard } from "./RouteCard";

export type Tab = "map" | "compare" | "why";
const TABS: { id: Tab; label: string }[] = [
  { id: "map", label: "Map" },
  { id: "compare", label: "Compare" },
  { id: "why", label: "Why" },
];

export interface ViewProps {
  person: Person;
  data: ExploreResult | undefined;
  error: string | undefined;
  tab: Tab;
  selected: Archetype;
  onTab: (tab: Tab) => void;
  onSelect: (archetype: Archetype) => void;
  onRetry: () => void;
}

/** The whole screen as a pure function of its props, so it can be rendered on the server and tested without a browser. */
export function PathView({
  person,
  data,
  error,
  tab,
  selected: chosen,
  onTab,
  onSelect,
  onRetry,
}: ViewProps) {
  const route = data?.routes.find((r) => r.archetype === chosen);
  const axisMax = data
    ? Math.max(
        36,
        Math.ceil(
          Math.max(0, ...data.routes.map((r) => r.monthsToGoal?.[1] ?? r.ignoringLimits.fastestMonths ?? 0)) /
            12,
        ) * 12,
      )
    : 60;
  const maxMonths = person.constraints.maxMonths;
  const youLabel = `${ROLE_LABEL[person.profile.roleFamily]} · ${person.profile.level}`;
  return (
    <div className="app">
      <header className="hero">
        <div className="hero__inner">
          <p className="brand">
            <span className="brand__mark" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="22" height="22">
                <path
                  d="M12 2 L13.6 10.4 L22 12 L13.6 13.6 L12 22 L10.4 13.6 L2 12 L10.4 10.4 Z"
                  fill="currentColor"
                />
              </svg>
            </span>
            Orionmatter
          </p>
          <h1 className="hero__title">Your route to {person.goal.label}</h1>
          <ul className="hero__chips" aria-label="About you">
            <li>{ROLE_LABEL[person.profile.roleFamily]}</li>
            <li>{person.profile.level}</li>
            <li>{person.profile.yearsExperience} years</li>
            <li>{REGION_LABEL[person.profile.region] ?? person.profile.region}</li>
            <li className="chip--quiet">Synthetic cohort of 484 engineers</li>
          </ul>
        </div>
      </header>

      <main className="main">
        <div className="tabs" role="tablist" aria-label="Views">
          {TABS.map((t) => (
            <button
              key={t.id}
              role="tab"
              type="button"
              id={`tab-${t.id}`}
              aria-selected={tab === t.id}
              aria-controls={`panel-${t.id}`}
              tabIndex={tab === t.id ? 0 : -1}
              className="tabs__tab"
              onClick={() => onTab(t.id)}
              onKeyDown={(event) => {
                const index = TABS.findIndex((x) => x.id === tab);
                if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
                  const next =
                    TABS[(index + (event.key === "ArrowRight" ? 1 : TABS.length - 1)) % TABS.length];
                  if (next) {
                    onTab(next.id);
                    document.getElementById(`tab-${next.id}`)?.focus();
                  }
                }
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        {error && (
          <div className="notice notice--error" role="alert">
            <p>{error}</p>
            <button type="button" className="button" onClick={onRetry}>
              Try again
            </button>
          </div>
        )}

        {!data && !error && (
          <div className="skeleton" aria-busy="true" aria-label="Loading your routes">
            <div className="skeleton__map" />
            <div className="skeleton__cards">
              <div />
              <div />
              <div />
            </div>
          </div>
        )}

        {data && route && (
          <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
            {data.conflicts.length > 0 && tab === "map" && (
              <div className="notice" role="status">
                {data.conflicts.map((c) => (
                  <p key={c.message}>{c.message}</p>
                ))}
              </div>
            )}
            {tab === "map" && (
              <>
                <Constellation
                  routes={data.routes}
                  maxMonths={maxMonths}
                  selected={chosen}
                  onSelect={onSelect}
                  goalLabel={person.goal.label}
                  youLabel={youLabel}
                />
                <p className="caption" aria-live="polite">
                  <strong>{ARCHETYPE_LABEL[chosen]}:</strong> {summaryLine(route)}
                </p>
                <div className="cards">
                  {data.routes.map((r) => (
                    <RouteCard
                      key={r.archetype}
                      route={r}
                      axisMax={axisMax}
                      selected={r.archetype === chosen}
                      recommended={data.ranking.recommended === r.archetype}
                      onSelect={() => onSelect(r.archetype)}
                    />
                  ))}
                </div>
                <RouteDetail route={route} maxMonths={maxMonths} />
              </>
            )}
            {tab === "compare" && <ComparePanel sheet={data} selected={chosen} />}
            {tab === "why" && <WhyPanel sheet={data} />}
          </div>
        )}
      </main>

      <footer className="footer">
        <p>
          Every range shows how many comparable engineers stand behind it. The cohort is synthetic, the
          numbers come from code, and nothing here is a promise.
        </p>
      </footer>
    </div>
  );
}

export function PathApp({ person = SAMPLE_PERSON }: { person?: Person }) {
  const [data, setData] = useState<ExploreResult | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [tab, setTab] = useState<Tab>("map");
  const [selected, setSelected] = useState<Archetype | undefined>();

  const load = useCallback(async () => {
    setError(undefined);
    try {
      const result = await postJson<ExploreResult>("/api/explore", person);
      setData(result);
      setSelected((current) => current ?? result.ranking.recommended ?? "climb");
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "Something went wrong. Please try again.");
    }
  }, [person]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <PathView
      person={person}
      data={data}
      error={error}
      tab={tab}
      selected={selected ?? "climb"}
      onTab={setTab}
      onSelect={setSelected}
      onRetry={() => void load()}
    />
  );
}

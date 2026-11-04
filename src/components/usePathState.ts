/**
 * usePathState.ts: all the state and every network call behind the screen.
 *
 * Two kinds of call, on purpose. Moving a slider calls the instant `/api/explore` route (no model, a few
 * milliseconds, debounced and cancellable, and the old numbers stay on screen until the new ones arrive).
 * Typing a sentence calls the streaming `/api/whatif` route, which reads the sentence with the model and
 * returns what it understood; the new limits are then applied and the instant route redraws the map. So the
 * map never waits on a model, and a stale answer can never overwrite a newer one.
 */
"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiClientError, postJson, streamPost } from "../lib/api/client";
import type { ExploreResult, WhatIfResult } from "../lib/api/handlers";
import type { Constraints } from "../lib/schemas";
import type { ClientPlanRun } from "../lib/api/serialize";
import type { Relaxation } from "../lib/whatif";
import {
  checkMessage,
  failTurn,
  finishTurn,
  holdTurn,
  progressTurn,
  releaseTurn,
  requestFor,
  startTurn,
  type Turn,
} from "../ui/chat";
import type { Archetype } from "../ui/format";
import { IDLE_PLAN, planFailed, planFinished, planProgress, planStarted, type PlanState } from "../ui/plan";
import { applyRelaxation, normalise, sameConstraints } from "../ui/limits";
import type { Person } from "../ui/sample";
import { addScenario, removeScenario, renameScenario, type Scenario } from "../ui/scenarios";
import { usePrivacy, type PrivacyBindings } from "./usePrivacy";
import type { WhatIfBindings } from "./WhatIfPanel";

/** Wait this long after the last slider movement before asking for new numbers. */
export const EXPLORE_DEBOUNCE_MS = 120;

const isAbort = (error: unknown): boolean => error instanceof Error && error.name === "AbortError";
const messageOf = (error: unknown): string =>
  error instanceof ApiClientError ? error.message : "Something went wrong. Please try again.";

export interface PathState {
  /** The person with the limits as they are now. */
  live: Person;
  data: ExploreResult | undefined;
  error: string | undefined;
  selected: Archetype | undefined;
  select: (archetype: Archetype) => void;
  retry: () => void;
  bindings: WhatIfBindings;
  /** The plan run: idle, running with a live trace, done, or failed. */
  plan: PlanState;
  onBuildPlan: () => void;
  privacy: PrivacyBindings;
}

export function usePathState(person: Person): PathState {
  const privacy = usePrivacy(person);
  const [constraints, setConstraints] = useState<Constraints>(person.constraints);
  const [data, setData] = useState<ExploreResult | undefined>();
  const [baseline, setBaseline] = useState<ExploreResult | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [refreshing, setRefreshing] = useState(true);
  const [selected, setSelected] = useState<Archetype | undefined>();
  const [attempt, setAttempt] = useState(0);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [chatBusy, setChatBusy] = useState(false);
  const [chatDraft, setChatDraft] = useState("");
  const [plan, setPlan] = useState<PlanState>(IDLE_PLAN);
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [scenarioNotice, setScenarioNotice] = useState<string | undefined>();

  // Refs hold the latest values for callbacks that outlive a render (the chat stream).
  const turnsRef = useRef<Turn[]>([]);
  const planRef = useRef<PlanState>(IDLE_PLAN);
  const planAbort = useRef<AbortController | undefined>(undefined);
  const constraintsRef = useRef(constraints);
  constraintsRef.current = constraints;

  const setTurnList = useCallback((next: Turn[]) => {
    turnsRef.current = next;
    setTurns(next);
  }, []);

  // The instant route: runs on every change of limits, debounced, and cancels the call it replaces.
  useEffect(() => {
    const controller = new AbortController();
    setRefreshing(true);
    const timer = setTimeout(
      () => {
        postJson<ExploreResult>(
          "/api/explore",
          { profile: person.profile, goal: person.goal, constraints },
          { signal: controller.signal },
        )
          .then((result) => {
            // A response that arrives after its request was replaced must not overwrite the newer numbers.
            if (controller.signal.aborted) return;
            setError(undefined);
            setData(result);
            // The first answer is always for the starting limits: the controls only exist once it has arrived.
            setBaseline((prev) => prev ?? result);
            setSelected((current) => current ?? result.ranking.recommended ?? "climb");
            setRefreshing(false);
          })
          .catch((e: unknown) => {
            if (isAbort(e) || controller.signal.aborted) return;
            setError(messageOf(e));
            setRefreshing(false);
          });
      },
      data ? EXPLORE_DEBOUNCE_MS : 0,
    );
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
    // `data` is read only to skip the delay on the very first load; it must not retrigger the call.
  }, [person.profile, person.goal, constraints, attempt]);

  const send = useCallback(
    async (raw: string): Promise<void> => {
      const checked = checkMessage(raw);
      if (!checked.ok) return;
      const sent = constraintsRef.current;
      const request = requestFor(turnsRef.current, checked.text, sent);
      const started = startTurn(turnsRef.current, checked.text);
      setTurnList(started.turns);
      setChatBusy(true);
      try {
        const result = await streamPost<WhatIfResult>(
          "/api/whatif",
          { ...request, profile: person.profile, goal: person.goal },
          {
            onEvent: (event) => {
              if (event.kind === "agent")
                setTurnList(progressTurn(turnsRef.current, started.id, event.event));
            },
          },
        );
        const finished = finishTurn(turnsRef.current, started.id, result);
        const next = result.interpretation.next;
        if (sameConstraints(next, sent)) {
          // The answer changed nothing (a greeting, a question, something that cannot be modelled): leave the
          // limits exactly as the person has them now, which may differ from what they were when it was asked.
          setTurnList(finished);
        } else if (!sameConstraints(constraintsRef.current, sent)) {
          // The person moved their limits while this was being worked out. Their newer choice wins; the
          // answer is kept behind a button instead of silently overwriting it.
          setTurnList(holdTurn(finished, started.id));
        } else {
          setTurnList(finished);
          setConstraints(normalise(next));
        }
      } catch (e) {
        setTurnList(failTurn(turnsRef.current, started.id, messageOf(e)));
      } finally {
        setChatBusy(false);
      }
    },
    [person.profile, person.goal, setTurnList],
  );

  const setPlanState = useCallback((next: PlanState) => {
    planRef.current = next;
    setPlan(next);
  }, []);

  // Leaving the screen ends a plan run that is still going: nobody is waiting for it.
  useEffect(() => () => planAbort.current?.abort(), []);

  const onBuildPlan = useCallback((): void => {
    if (planRef.current.phase === "running") return;
    const asked = constraintsRef.current;
    const controller = new AbortController();
    planAbort.current = controller;
    setPlanState(planStarted(asked));
    streamPost<ClientPlanRun>(
      "/api/plan",
      { profile: person.profile, goal: person.goal, constraints: asked },
      {
        signal: controller.signal,
        onEvent: (event) => {
          if (event.kind === "agent") setPlanState(planProgress(planRef.current, event.event));
        },
      },
    )
      .then((result) => {
        if (!controller.signal.aborted) setPlanState(planFinished(planRef.current, result));
      })
      .catch((e: unknown) => {
        if (isAbort(e) || controller.signal.aborted) return;
        setPlanState(planFailed(planRef.current, messageOf(e)));
      });
  }, [person.profile, person.goal, setPlanState]);

  const bindings = useMemo<WhatIfBindings>(
    () => ({
      baseline,
      changed: !sameConstraints(constraints, person.constraints),
      refreshing,
      turns,
      chatBusy,
      chatDraft,
      scenarios,
      scenarioNotice,
      onChange: (next) => setConstraints(normalise(next)),
      onReset: () => setConstraints(person.constraints),
      onSend: (text) => void send(text),
      onChatDraft: setChatDraft,
      onApplyHeld: (turnId) => {
        const held = turnsRef.current.find((t) => t.id === turnId);
        if (!held?.result) return;
        const next = held.result.interpretation.next;
        setTurnList(releaseTurn(turnsRef.current, turnId));
        setConstraints(normalise(next));
      },
      onApply: (relaxation: Relaxation) => setConstraints((c) => applyRelaxation(c, relaxation)),
      onSaveScenario: () => {
        if (!data || refreshing || !sameConstraints(data.constraints, constraints)) {
          setScenarioNotice("Wait for the map to finish updating, then save.");
          return;
        }
        const result = addScenario(scenarios, constraints, data);
        setScenarios(result.list);
        setScenarioNotice(result.ok ? `Saved as ${result.added.name}.` : result.message);
      },
      onOpenScenario: (id) => {
        const found = scenarios.find((s) => s.id === id);
        if (found) setConstraints(found.constraints);
        setScenarioNotice(undefined);
      },
      onRemoveScenario: (id) => {
        setScenarios((list) => removeScenario(list, id));
        setScenarioNotice(undefined);
      },
      onRenameScenario: (id, name) => setScenarios((list) => renameScenario(list, id, name)),
    }),
    [
      baseline,
      constraints,
      person.constraints,
      refreshing,
      turns,
      chatBusy,
      chatDraft,
      scenarios,
      scenarioNotice,
      data,
      send,
      setTurnList,
    ],
  );

  return {
    live: { ...person, constraints },
    data,
    error,
    selected,
    select: setSelected,
    retry: () => setAttempt((n) => n + 1),
    bindings,
    plan,
    onBuildPlan,
    privacy,
  };
}

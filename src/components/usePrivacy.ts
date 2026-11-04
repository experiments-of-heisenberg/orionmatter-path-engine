/**
 * usePrivacy.ts: the state and the network calls behind the Privacy tab.
 *
 * Two kinds of call. The ladder (no text) is computed by code alone and loads when the screen opens and whenever
 * the crowd size or company type changes; a newer request cancels an older one. The text check runs only when the
 * person asks, in one of two ways: with Muse Spark reading the text, or with code only. The draft text lives here
 * so it survives a change of tab, and a result is marked as made for other settings when the settings move.
 */
"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiClientError, postJson } from "../lib/api/client";
import type { PrivacyAssessment } from "../lib/privacy";
import { DEFAULT_K_UI, checkStory, privacyBody, type PrivacySettings } from "../ui/privacy";
import type { Person } from "../ui/sample";

export type LadderState =
  { phase: "loading" } | { phase: "done"; result: PrivacyAssessment } | { phase: "error"; error: string };

export type TextCheckState =
  | { phase: "idle" }
  | { phase: "running"; usedModel: boolean }
  | { phase: "done"; result: PrivacyAssessment; usedModel: boolean; settings: PrivacySettings }
  | { phase: "error"; error: string };

export interface PrivacyBindings {
  settings: PrivacySettings;
  ladder: LadderState;
  textCheck: TextCheckState;
  draft: string;
  /** A message about the draft itself (empty, too long), shown by the box. */
  draftProblem: string | undefined;
  onK: (k: number) => void;
  onCompanyType: (type: string | undefined) => void;
  onDraft: (text: string) => void;
  onCheck: (useModel: boolean) => void;
  onRetryLadder: () => void;
}

/** Bindings for a screen that is not interactive, such as a static render. */
export const IDLE_PRIVACY: PrivacyBindings = {
  settings: { k: DEFAULT_K_UI, companyType: undefined },
  ladder: { phase: "loading" },
  textCheck: { phase: "idle" },
  draft: "",
  draftProblem: undefined,
  onK: () => undefined,
  onCompanyType: () => undefined,
  onDraft: () => undefined,
  onCheck: () => undefined,
  onRetryLadder: () => undefined,
};

const isAbort = (error: unknown): boolean => error instanceof Error && error.name === "AbortError";
const messageOf = (error: unknown): string =>
  error instanceof ApiClientError ? error.message : "Something went wrong. Please try again.";

export function usePrivacy(person: Person): PrivacyBindings {
  const [settings, setSettings] = useState<PrivacySettings>({ k: DEFAULT_K_UI, companyType: undefined });
  const [ladder, setLadder] = useState<LadderState>({ phase: "loading" });
  const [textCheck, setTextCheck] = useState<TextCheckState>({ phase: "idle" });
  const [draft, setDraft] = useState("");
  const [draftProblem, setDraftProblem] = useState<string | undefined>();
  const [attempt, setAttempt] = useState(0);
  const checkAbort = useRef<AbortController | undefined>(undefined);
  const running = useRef(false);

  // The ladder: code only, so it is quick; a newer request replaces an older one.
  useEffect(() => {
    const controller = new AbortController();
    setLadder({ phase: "loading" });
    postJson<PrivacyAssessment>(
      "/api/privacy",
      { profile: person.profile, goal: person.goal, ...privacyBody(settings) },
      { signal: controller.signal },
    )
      .then((result) => {
        if (!controller.signal.aborted) setLadder({ phase: "done", result });
      })
      .catch((e: unknown) => {
        if (isAbort(e) || controller.signal.aborted) return;
        setLadder({ phase: "error", error: messageOf(e) });
      });
    return () => controller.abort();
  }, [person.profile, person.goal, settings, attempt]);

  // Leaving the screen ends a text check that is still going.
  useEffect(() => () => checkAbort.current?.abort(), []);

  const onCheck = useCallback(
    (useModel: boolean): void => {
      if (running.current) return;
      const checked = checkStory(draft);
      if (!checked.ok) {
        setDraftProblem(checked.message);
        return;
      }
      setDraftProblem(undefined);
      running.current = true;
      const controller = new AbortController();
      checkAbort.current = controller;
      const asked = settings;
      setTextCheck({ phase: "running", usedModel: useModel });
      postJson<PrivacyAssessment>(
        "/api/privacy",
        {
          profile: person.profile,
          goal: person.goal,
          ...privacyBody(asked, { text: checked.text, useModel }),
        },
        { signal: controller.signal },
      )
        .then((result) => {
          if (!controller.signal.aborted)
            setTextCheck({ phase: "done", result, usedModel: useModel, settings: asked });
        })
        .catch((e: unknown) => {
          if (isAbort(e) || controller.signal.aborted) return;
          setTextCheck({ phase: "error", error: messageOf(e) });
        })
        .finally(() => {
          running.current = false;
        });
    },
    [draft, settings, person.profile, person.goal],
  );

  return useMemo<PrivacyBindings>(
    () => ({
      settings,
      ladder,
      textCheck,
      draft,
      draftProblem,
      onK: (k) => setSettings((s) => ({ ...s, k })),
      onCompanyType: (companyType) => setSettings((s) => ({ ...s, companyType })),
      onDraft: (text) => {
        setDraft(text);
        setDraftProblem(undefined);
      },
      onCheck,
      onRetryLadder: () => setAttempt((n) => n + 1),
    }),
    [settings, ladder, textCheck, draft, draftProblem, onCheck],
  );
}

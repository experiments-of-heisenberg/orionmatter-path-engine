/**
 * useIntake.ts: the state and network calls behind the "Your story" tab.
 *
 * It lives above the screen, not inside it, so the form survives the screen being rebuilt when a person is confirmed.
 * Reading goes through the streaming intake route. The result becomes an editable form; the person can correct or
 * fill any field by hand, and an answer to a question sends their corrected form back, so edits are never lost.
 * Confirming validates the form and hands the person to the app. Nothing is verified at any point.
 */
"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiClientError, streamPost } from "../lib/api/client";
import type { IntakeResult } from "../lib/intake";
import {
  EMPTY_FORM,
  checkImageFile,
  checkIntakeInput,
  editedKeys,
  formFromDraft,
  intakeBody,
  keepEdits,
  personFromForm,
  previousForRead,
  previousFrom,
  type FormValues,
} from "../ui/intake";
import type { Person } from "../ui/sample";

export type IntakePhase = "idle" | "reading" | "done" | "error";

export interface IntakeBindings {
  text: string;
  image: { name: string; dataUrl: string } | undefined;
  phase: IntakePhase;
  /** What the agent is doing while reading. */
  stage: string | undefined;
  result: IntakeResult | undefined;
  error: string | undefined;
  /** A problem with the input itself (empty, too long, a bad file). */
  problem: string | undefined;
  form: FormValues;
  /** The provenance keys the person has changed since the draft. */
  edited: ReadonlySet<string>;
  /** The reply to a question, typed in the answer box. */
  answer: string;
  /** What is wrong with the form when Confirm was pressed, in words. */
  confirmProblems: string[];
  onText: (text: string) => void;
  onFile: (file: File | undefined) => void;
  onClearImage: () => void;
  onRead: () => void;
  onAnswer: (text: string) => void;
  onSendAnswer: () => void;
  onForm: (update: (form: FormValues) => FormValues) => void;
  onConfirm: () => void;
}

export const IDLE_INTAKE: IntakeBindings = {
  text: "",
  image: undefined,
  phase: "idle",
  stage: undefined,
  result: undefined,
  error: undefined,
  problem: undefined,
  form: EMPTY_FORM,
  edited: new Set(),
  answer: "",
  confirmProblems: [],
  onText: () => undefined,
  onFile: () => undefined,
  onClearImage: () => undefined,
  onRead: () => undefined,
  onAnswer: () => undefined,
  onSendAnswer: () => undefined,
  onForm: () => undefined,
  onConfirm: () => undefined,
};

const isAbort = (error: unknown): boolean => error instanceof Error && error.name === "AbortError";
const messageOf = (error: unknown): string =>
  error instanceof ApiClientError ? error.message : "Something went wrong. Please try again.";

/** Read a file as a data URL. */
function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("unreadable"));
    reader.onerror = () => reject(new Error("unreadable"));
    reader.readAsDataURL(file);
  });
}

export function useIntake(onConfirm: (person: Person) => void): IntakeBindings {
  const [text, setText] = useState("");
  const [image, setImage] = useState<IntakeBindings["image"]>();
  const [phase, setPhase] = useState<IntakePhase>("idle");
  const [stage, setStage] = useState<string | undefined>();
  const [result, setResult] = useState<IntakeResult | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [problem, setProblem] = useState<string | undefined>();
  const [form, setForm] = useState<FormValues>(EMPTY_FORM);
  const [answer, setAnswer] = useState("");
  const [confirmProblems, setConfirmProblems] = useState<string[]>([]);
  const abort = useRef<AbortController | undefined>(undefined);
  const busy = useRef(false);
  const formRef = useRef(form);
  formRef.current = form;
  const resultRef = useRef<IntakeResult | undefined>(undefined);
  resultRef.current = result;

  useEffect(() => () => abort.current?.abort(), []);

  const run = useCallback(
    (body: ReturnType<typeof intakeBody>, laidOver: { before: FormValues; original: FormValues }): void => {
      if (busy.current) return;
      busy.current = true;
      const controller = new AbortController();
      abort.current = controller;
      setPhase("reading");
      setStage("Reading\u2026");
      setError(undefined);
      streamPost<IntakeResult>("/api/intake", body, {
        signal: controller.signal,
        onEvent: (event) => {
          if (event.kind === "agent" && event.event.type === "stage") {
            const words: Record<string, string> = {
              reading: "Reading what you wrote\u2026",
              protecting: "Removing contact details\u2026",
            };
            setStage(words[event.event.stage] ?? "Reading\u2026");
          }
        },
      })
        .then((next) => {
          if (controller.signal.aborted) return;
          setResult(next);
          // The person's own corrections stay on top of whatever the new reading found.
          setForm(keepEdits(formFromDraft(next.draft), laidOver.before, laidOver.original));
          setAnswer("");
          setConfirmProblems([]);
          setPhase("done");
        })
        .catch((e: unknown) => {
          if (isAbort(e) || controller.signal.aborted) return;
          setError(messageOf(e));
          setPhase("error");
        })
        .finally(() => {
          busy.current = false;
        });
    },
    [],
  );

  const onRead = useCallback((): void => {
    const checked = checkIntakeInput({ text, image });
    if (!checked.ok) {
      setProblem(checked.message);
      return;
    }
    setProblem(undefined);
    const prior = resultRef.current;
    const before = formRef.current;
    run(intakeBody({ text: checked.text, image }, previousForRead(prior, before)), {
      before,
      original: prior ? formFromDraft(prior.draft) : EMPTY_FORM,
    });
  }, [text, image, run]);

  const onSendAnswer = useCallback((): void => {
    const prior = resultRef.current;
    const checked = checkIntakeInput({ text: answer, image: undefined });
    if (!checked.ok || !prior) {
      setProblem(checked.ok ? undefined : "Type your answer first.");
      return;
    }
    setProblem(undefined);
    const before = formRef.current;
    run(intakeBody({ text: checked.text, image: undefined }, previousFrom(prior, before)), {
      before,
      original: formFromDraft(prior.draft),
    });
  }, [answer, run]);

  const onFile = useCallback((file: File | undefined): void => {
    if (!file) return;
    const checked = checkImageFile(file);
    if (!checked.ok) {
      setProblem(checked.message);
      return;
    }
    readAsDataUrl(file)
      .then((dataUrl) => {
        setProblem(undefined);
        setImage({ name: file.name, dataUrl });
      })
      .catch(() => setProblem("That file could not be read. Please try another."));
  }, []);

  const onConfirmPressed = useCallback((): void => {
    const confirmedPerson = personFromForm(formRef.current);
    if (!confirmedPerson.ok) {
      setConfirmProblems(confirmedPerson.problems);
      return;
    }
    setConfirmProblems([]);
    onConfirm(confirmedPerson.person);
  }, [onConfirm]);

  const edited = useMemo(
    () => (result ? editedKeys(formFromDraft(result.draft), form) : new Set<string>()),
    [result, form],
  );

  return useMemo<IntakeBindings>(
    () => ({
      text,
      image,
      phase,
      stage,
      result,
      error,
      problem,
      form,
      edited,
      answer,
      confirmProblems,
      onText: (t) => {
        setText(t);
        setProblem(undefined);
      },
      onFile,
      onClearImage: () => setImage(undefined),
      onRead,
      onAnswer: (t) => {
        setAnswer(t);
        setProblem(undefined);
      },
      onSendAnswer,
      onForm: (update) => setForm(update),
      onConfirm: onConfirmPressed,
    }),
    [
      text,
      image,
      phase,
      stage,
      result,
      error,
      problem,
      form,
      edited,
      answer,
      confirmProblems,
      onFile,
      onRead,
      onSendAnswer,
      onConfirmPressed,
    ],
  );
}

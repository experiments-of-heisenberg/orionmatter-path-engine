/**
 * SharePanel.tsx: the Share tab. A card of the three routes that can be saved as a picture or copied as text.
 *
 * What goes on the card is decided by the privacy ladder: only details that keep the person in a crowd of at least k.
 * The panel shows exactly what is shown and what is withheld, and the crowd size behind it, before anything is saved.
 * The card is made in the browser; nothing is uploaded. If the privacy count is not available, no card is offered,
 * because a card made without it could show too much.
 */
import { useRef, useState } from "react";
import type { ExploreResult } from "../lib/api/handlers";
import { copyText, saveBlob, saveSvg, svgToPng } from "../ui/exportCard";
import type { Person } from "../ui/sample";
import { cardFileName, cardText, trailCardModel } from "../ui/trailCard";
import { TrailCard } from "./TrailCard";
import type { PrivacyBindings } from "./usePrivacy";

export function SharePanel({
  person,
  data,
  privacy,
}: {
  person: Person;
  data: ExploreResult;
  privacy: PrivacyBindings;
}) {
  const svg = useRef<SVGSVGElement>(null);
  const [message, setMessage] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const ready = privacy.ladder.phase === "done" ? privacy.ladder.result : undefined;
  const model = ready ? trailCardModel(person, data, ready) : undefined;

  const png = async (): Promise<void> => {
    if (!svg.current || !model) return;
    setBusy(true);
    setMessage(undefined);
    const out = await svgToPng(svg.current);
    setBusy(false);
    if (out.ok) {
      saveBlob(out.blob, cardFileName(model, "png"));
      setMessage("Saved as a picture.");
    } else setMessage(out.message);
  };
  const vector = (): void => {
    if (!svg.current || !model) return;
    saveSvg(svg.current, cardFileName(model, "svg"));
    setMessage("Saved as an SVG file.");
  };
  const copy = async (): Promise<void> => {
    if (!model) return;
    setMessage(
      (await copyText(cardText(model)))
        ? "Copied as text."
        : "Your browser would not allow copying. Select the text below instead.",
    );
  };

  return (
    <div className="share">
      <section className="panel" aria-labelledby="share-title">
        <h2 className="panel__title" id="share-title">
          Share your trail
        </h2>
        <p className="panel__lede">
          A card of your three routes you can post. It shows only the details that keep you in a crowd of at
          least {privacy.settings.k} comparable engineers. Change that on the Privacy tab. The card is made in
          your browser and nothing is uploaded.
        </p>
        {privacy.ladder.phase === "loading" && (
          <p className="panel__fine" role="status">
            {"Working out what is safe to show\u2026"}
          </p>
        )}
        {privacy.ladder.phase === "error" && (
          <div className="notice notice--error" role="alert">
            <p>The card needs the privacy count first, and it could not be loaded. {privacy.ladder.error}</p>
            <button type="button" className="button" onClick={privacy.onRetryLadder}>
              Try again
            </button>
          </div>
        )}
        {model && (
          <>
            <div className="share__what">
              <p>
                <strong>On the card:</strong>{" "}
                {model.shown.length > 0 ? model.shown.join(", ") : "none of your personal details"}
                {model.crowd !== null ? `. Together they match ${model.crowd} comparable engineers.` : "."}
              </p>
              {model.withheld.length > 0 && (
                <p>
                  <strong>Left off:</strong> {model.withheld.join("; ")}.
                </p>
              )}
              <p className="panel__fine">
                Years of experience, technologies and anything you wrote are never put on the card.
              </p>
            </div>
            <TrailCard ref={svg} model={model} />
            <div className="chat__actions share__buttons">
              <span className="privacy__buttons">
                <button
                  type="button"
                  className="button button--primary"
                  disabled={busy}
                  onClick={() => void png()}
                >
                  {busy ? "Making\u2026" : "Save as picture"}
                </button>
                <button type="button" className="button" onClick={vector}>
                  Save as SVG
                </button>
                <button type="button" className="button" onClick={() => void copy()}>
                  Copy as text
                </button>
              </span>
            </div>
            {message && (
              <p className="panel__fine" role="status">
                {message}
              </p>
            )}
            <details className="share__text">
              <summary>The card as text</summary>
              <pre>{cardText(model)}</pre>
            </details>
          </>
        )}
      </section>
    </div>
  );
}

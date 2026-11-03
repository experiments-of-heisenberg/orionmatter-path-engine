# ADR 0012: A Privacy Guard whose verdict is code

- Status: accepted
- Date: 2026-11-03

## Context

The product lets a person share a trail (a card, a post). Two different things can identify them: the
combination of attributes (role, level, goal, region, company type) and the details in the free text
(names, employers, projects, dates, pay). We want to warn about both, honestly, without inventing
certainty and without letting a model decide what is "safe".

## Decision

1. **The attribute half is deterministic.** A disclosure ladder adds one attribute at a time and
   counts the comparable engineers who still match (the existing `kAnonymity` tool). The crowd only
   shrinks, so the ladder shows exactly where a person stops being one of many, and which attribute to
   drop to get back to a crowd of k (default 10).
2. **The text half is split by who is better at it.** Code finds what has a fixed shape: contact
   details, exact dates, exact pay. Muse Spark finds what needs a reader: names, employers, projects,
   schools, small-team details, searchable achievements. Spark's findings are kept only if their quote is
   in the person's text (whole words) and is not a word the profile already shares.
3. **Code decides the verdict.** Risk is high for contact details, a named person or a crowd under 3;
   medium for a crowd under k or any other finding; low otherwise. The reasons are written by code.
4. **The safe version uses fixed placeholders.** The preview replaces each finding with a placeholder
   for its category. The model's words never enter it, so it cannot carry anything the model made up.
5. **Degrade, never fail.** If the model is unavailable or the person switches it off (`useModel: false`,
   nothing is sent), the Guard still returns the ladder, the detectors and a preview, and says the text
   check was code-only.
6. **Say what it is not.** The cohort is synthetic, so the ladder shows the method on this dataset
   and is not a claim about real-world uniqueness. The model reads the person's text on the Meta Model
   API, with contact details removed first. We do not claim on-device, self-hosted or open-weights
   processing.

## Consequences

- Positive: a verdict a person can audit; the model cannot lower the risk or write the preview; live,
  27 of 27 evaluation runs passed, including stories that tried to talk the reviewer out of flagging.
- Negative: names are found only by the model, so a missed name is a missed finding. The risk level
  can only be as good as the findings, and the guide says so.
- Negative: exact-match counting uses the cohort's starting levels (L4, L5) only; other levels are
  left out of the ladder with a note, which understates identifiability.

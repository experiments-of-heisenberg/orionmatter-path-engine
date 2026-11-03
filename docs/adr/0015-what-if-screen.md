# ADR 0015: Two paths for "what if", and the person's newest choice always wins

- Status: accepted
- Date: 2026-11-04

## Context

The What if tab has to feel instant when someone drags a limit and still let them type a sentence. A model call takes
8 to 25 seconds; a recomputation from the cohort takes milliseconds. The two must not block each other, and the screen must
never show numbers that belong to limits the person has already moved past.

## Decision

1. **Two paths.** Sliders, switches and buttons call the model-free `/api/explore` route, debounced by 120 ms and cancelled
   when superseded. Sentences call the streaming `/api/whatif` route, which uses the model only to read the sentence and to
   phrase the explanation; the recomputation, the diff, the tornado and every number come from code. After a sentence is
   understood the new limits are applied to the same state and the instant route redraws the map. So the map never waits on a model.
2. **The newest choice wins.** A response that arrives after its request was replaced is ignored (the call is aborted and
   a guard checks the signal). If the person moves a limit while a sentence is being worked out, the sentence's changes are not
   applied over their move: the answer is kept, labelled "Understood, not applied", behind an "Apply these changes instead"
   button. An answer that changes nothing never touches the limits.
3. **State lives in one hook** (`usePathState`), so the components are pure functions of their props and render to static HTML
   for tests; the half-typed message lives there too, so it survives a change of tab.
4. **Every claim is checkable.** Chips use the server's own thresholds (5 points, 3 months, kept equal by a test); the tornado's
   swing is the server's rounded number; a scenario is called "highest" only by its middle, and "clearly" only when its low end
   is above the next one's high end; a suggestion carries a structured value (`Relaxation.value`) so the screen applies exactly
   what the engine tested, instead of parsing display text.
5. **Small, honest scope.** Four scenarios, browser-only, no persistence across reloads; one change at a time in "what would it take".

## Consequences

- Positive: the screen answers a slider in a few milliseconds and a sentence in seconds without ever blocking; a stale answer can
  neither overwrite newer limits nor sneak in silently.
- Negative: a held answer needs one extra click; scenarios are lost on reload; the map does not animate between states.
- Testing: a simulated browser drives the real components and hook against the real route handlers with a scripted model, which is
  how the stale-answer, held-answer and draft-survival cases are covered. Muse Code's bug hunt found the held-answer and draft cases.

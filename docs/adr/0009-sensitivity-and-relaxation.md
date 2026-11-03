# ADR 0009: Sensitivity and "what would it take" without a model

- Status: accepted
- Date: 2026-11-03

## Context

After a What-if change a person asks two things: which of my constraints costs me the most, and,
when no route is left, what is the smallest thing I could give up. Both can be answered from
the evidence. A model asked to answer them would have to be trusted with numbers; code does not.

## Decision

1. **One shared yardstick.** Both questions measure the same thing: the route the plan would
   suggest first, as a success range with the number of comparable engineers behind it. Never a
   bare number, and when no route has anyone who met the limits the metric says so (route null)
   instead of reporting a zero.
2. **The tornado tries each knob's alternatives with everything else held fixed**, then ranks
   knobs by how far the metric moves. Only four knobs are bars: remote, no relocation, time limit and
   pay floor. Risk tolerance (it reorders routes) and skills (a with/without comparison) change
   something a success rate cannot show, so a bar for them would read as "does nothing" and be
   false.
3. **"What would it take" relaxes one constraint at a time**, finding the smallest relaxation of
   each that reaches a target (default: 10 comparable engineers who made it within the limits and
   a success range centred on 50%). One knob at a time keeps each answer a clean "if you changed
   just this". If none works alone it says so; it does not search combinations and present a guess.
4. **Deterministic and fast.** No model, a few milliseconds, so the interface can recompute on every
   slider move. Every sentence is written by code with its numbers listed, like the diff facts.

## Consequences

- Positive: the tornado and the relaxations are exactly reproducible and pinned by tests with real
  numbers; the interface can show them without a loading state.
- Negative: single-knob answers can be large (a long time limit) and ignore combinations that
  would be a smaller total change. We chose honesty about what was searched over a cleverer answer.
- Negative: the tornado tries fixed values (12 to 60 months, B3 to B5), so a person's best value
  may fall between them; their own current value is always included.

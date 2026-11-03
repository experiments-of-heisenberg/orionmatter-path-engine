# Evidence from real runs

Files here are unedited output from live runs against the real models. They contain only
synthetic-cohort content. Nothing in them was staged or hand-edited.

- `live-audit-real-rejection.json`: a full Planner and Skeptic run (3 Nov 2026) for a backend
  engineer aiming for Staff with remote and no-relocation constraints. The first plan was
  **rejected by the deterministic verifier**: a pay claim said `n=34` while the comp evidence it
  cited had `n=53` (`n_mismatch`). The Planner revised the wording, the second audit approved it,
  and every number in the final plan still comes from the ledger. `verdicts[0].rejections` shows
  the rejection; `plan` is the approved result.

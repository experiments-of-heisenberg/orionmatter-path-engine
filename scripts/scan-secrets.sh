#!/usr/bin/env bash
# scan-secrets.sh: best-effort check that no credentials are committed.
#
# Scans every git-tracked AND untracked-but-not-ignored file for patterns that look
# like API keys, so `npm run check` agrees with what the pre-commit hook will see. These are heuristics, not a guarantee: they catch the common accidents
# (a pasted Meta key, a hard-coded token) cheaply, in the pre-commit hook and in CI.
#
# Intentional fakes (e.g. test fixtures) can be marked by putting `scan-secrets:allow`
# in a comment on the same line; those lines are skipped.
#
# Exit code 0 = clean, 1 = suspected secret found (file and line shown, value hidden).
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

# Meta Model API keys look like LLM_<digits>_<secret>.
meta_key='LLM_[0-9]{6,}_[A-Za-z0-9]{8,}'
# Generic: a key/secret/token assigned a long literal string.
generic='(api[_-]?key|secret|token|password)[[:space:]]*[:=][[:space:]]*["'"'"'][A-Za-z0-9_.+/=-]{24,}["'"'"']'
# Authorization header with a long literal bearer value (not a $variable).
bearer='Bearer[[:space:]]+[A-Za-z0-9_.-]{24,}'

# Files that legitimately contain example patterns.
exclude=(':!package-lock.json' ':!scripts/scan-secrets.sh' ':!data/cohort.synthetic.json')

found=0
for pattern in "$meta_key" "$generic" "$bearer"; do
  # -I skips binary files; --untracked includes new files; -n shows line numbers.
  # Lines marked `scan-secrets:allow` are dropped, and we print location only, never the match.
  if matches=$(git grep -InE -i --untracked "$pattern" -- . "${exclude[@]}" 2>/dev/null \
    | { grep -v 'scan-secrets:allow' || true; } | cut -d: -f1,2); [[ -n "$matches" ]]; then
    echo "Possible secret (pattern: ${pattern:0:30}...) at:" >&2
    echo "$matches" | sed 's/^/  /' >&2
    found=1
  fi
done

if [[ $found -eq 1 ]]; then
  echo "scan-secrets: FAILED. Remove the value, rotate the key if it was real." >&2
  exit 1
fi
echo "scan-secrets: clean"

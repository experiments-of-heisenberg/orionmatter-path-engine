#!/usr/bin/env bash
# muse-run.sh — run one Muse Code task headlessly and keep auditable evidence.
#
# Why this exists: we want every Muse Code contribution to be (a) run the same safe
# way, (b) reproducible from a prompt file, and (c) backed by a session log a judge
# can inspect. This script does all three.
#
# Usage (must run with the model keys in the environment, e.g. via with_keys.sh):
#   bash scripts/muse-run.sh <slug> <prompt-file> [max-steps]
#
#   slug         short name for the task, e.g. "part2-data-docs"
#   prompt-file  path to a text file containing the task prompt
#   max-steps    cap on model steps (default 40) so a stuck run cannot loop
#
# Evidence written to docs/muse-code/ (relative to the current directory):
#   <slug>.prompt.md       the exact prompt given to Muse Code
#   <slug>.final.txt       Muse Code's final message
#   <slug>.session.json    redacted session export (messages, tool calls, results)
#
# Safety notes:
#   * The OS sandbox helper (bwrap) is unavailable in our container, so we pass
#     --disable-sandbox. That is acceptable ONLY because the container is disposable.
#     To limit exposure, Muse Code receives just META_API_KEY; MODEL_API_KEY and
#     BASETEN_API_KEY are removed from its environment.
#   * After the run we scan the export for our key values and delete it on a match.
#   * Muse Code's exit code only says the run finished, not that the work is right.
#     Always verify with the project's own tests afterwards.
set -euo pipefail

slug="${1:?usage: muse-run.sh <slug> <prompt-file> [max-steps]}"
prompt_file="${2:?usage: muse-run.sh <slug> <prompt-file> [max-steps]}"
max_steps="${3:-40}"

: "${MODEL_API_KEY:?MODEL_API_KEY must be set (run via with_keys.sh)}"
export PATH="$HOME/.local/bin:$PATH"
command -v muse >/dev/null || { echo "muse-run.sh: muse CLI not found on PATH" >&2; exit 69; }
[[ -f "$prompt_file" ]] || { echo "muse-run.sh: prompt file not found: $prompt_file" >&2; exit 66; }

evidence_dir="docs/muse-code"
mkdir -p "$evidence_dir"
cp "$prompt_file" "$evidence_dir/$slug.prompt.md"

# Remember the key values for the leak scan, then hide them from Muse Code.
scan_model_key="$MODEL_API_KEY"
scan_baseten_key="${BASETEN_API_KEY:-}"
export META_API_KEY="${META_API_KEY:-$MODEL_API_KEY}"

echo "muse-run: starting '$slug' (max $max_steps steps)"
set +e
env -u MODEL_API_KEY -u BASETEN_API_KEY \
  timeout 900 muse exec \
    --disable-sandbox --disable-approval --trust-workspace \
    --max-model-steps "$max_steps" \
    --prompt-file "$prompt_file" \
  >"$evidence_dir/$slug.final.txt" 2>"$evidence_dir/$slug.stderr.log"
muse_status=$?
set -e
rm -f "$evidence_dir/$slug.stderr.log" # diagnostics only; not evidence
echo "muse-run: muse exec finished with exit code $muse_status (0 = turn completed, NOT proof of correctness)"

# Export the redacted session log as evidence.
muse export --last --redacted --out "$evidence_dir/$slug.session.json" >/dev/null

# Leak scan: refuse to keep evidence that contains either key value.
for secret in "$scan_model_key" "$scan_baseten_key"; do
  [[ -n "$secret" ]] || continue
  if grep -rqF -- "$secret" "$evidence_dir/$slug."*; then
    echo "muse-run: SECRET FOUND in evidence files; deleting them" >&2
    rm -f "$evidence_dir/$slug."*
    exit 70
  fi
done
echo "muse-run: evidence saved to $evidence_dir/$slug.* (leak scan clean)"
exit "$muse_status"

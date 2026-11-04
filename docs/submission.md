# Submission checklist and draft text

**Deadline: 4 November 2026, 9:00 PM ET (5 November, about 7:30 AM IST).** Submit with time to spare: a form that rejects a link at the last minute is the most common way to lose a good project.

Track: **Indie.** Problem statement: **Build for Your World.**

## Checklist, in the order to do it

- [ ] **Repo is public**, `main` is green in the Actions tab, and the latest commit is the one you want judged. Open it in a private window to be sure.
- [ ] **No secret in the repo**: `bash scripts/scan-secrets.sh` is clean and GitHub's secret scanning shows nothing (Settings, Code security).
- [ ] **Live deployment** is up and `npm run smoke -- <live-url> --model` passes ([`deploy.md`](deploy.md)).
- [ ] **Demo deployment** is up and `npm run smoke -- <demo-url> --plan` passes. Put both links in the repo's About box.
- [ ] **Video** recorded from [`demo.md`](demo.md), under three minutes, uploaded (YouTube unlisted or the form's own upload), and the link opened in a private window.
- [ ] **README** first screen shows the one-line description, the live link, the demo link and the video link. Replace the placeholders below.
- [ ] **Muse Code evidence** is visible: `docs/muse-code/README.md` lists the runs; the README's "Built with Muse Code" section says what you actually did; mention it in the submission text.
- [ ] **Team and contact** fields filled in; any required consent or terms boxes ticked.
- [ ] **Submit**, then reopen the submission page and click every link once.

## Links to fill in

| What                                | URL           |
| ----------------------------------- | ------------- |
| Repository                          | `<REPO_URL>`  |
| Live app                            | `<LIVE_URL>`  |
| Demo app (no key, recorded answers) | `<DEMO_URL>`  |
| Video                               | `<VIDEO_URL>` |

## One line

A career route planner for engineers that shows its work: three honest ranges, a Skeptic that rejects claims the data cannot back, and What if that explains every change.

## Short description (about 300 characters)

Orionmatter Path Engine plans an engineer's next career move on Muse Spark. Three routes appear as ranges with sample sizes. A Planner proposes, a Skeptic checks every figure against evidence, What if re-plans from a sentence, and a Privacy Guard shows what sharing your story reveals.

## Long description

**The problem.** Career advice from a chatbot is fluent and unaccountable. Someone choosing between staying, switching companies and retraining needs the opposite: how many comparable people made it, how long it took, how sure we are, and what is unknown. They also have to hand over details about themselves to get that, and nobody tells them how identifying those details are.

**What it does.** You describe your career in your own words (or upload a cropped screenshot). Orionmatter shows three routes (climb, jump, pivot) as ranges with the number of engineers behind each, on a constellation map. You can ask What if in a sentence or drag limits; the map redraws and the app says what moved and which limit matters most. A Planner agent writes a plan with evidence for every claim, and a Skeptic agent checks every figure against that evidence and sends the plan back with the exact words it objected to. A Privacy Guard counts how large a crowd you hide in as you share more, checks text you plan to post, and a trail card shows only what keeps you in a crowd of at least k.

**How it uses Meta's tools.** Every model call goes through the Meta Model API to Muse Spark (`muse-spark-1.3`): tool calling for the Planner, structured JSON for the interpreter, narrator, critic and privacy check, and vision for screenshot intake. Muse Code was in the development loop for every part from the data layer to the offline demo: it wrote edge-case tests, ran a bug hunt and wrote the guides, and its runs are recorded in the repository (prompts, final messages and session exports).

**How it is built.** The model writes and explains; code owns every number and every verdict. Each figure comes from a tool run against the cohort and is recorded in an evidence ledger; the Skeptic's verifier rejects a claim whose evidence is missing, has a different sample size or supports no such range; the What if narrator is rejected unless every number it states was computed. Strict TypeScript, Zod at every boundary, typed errors, redacted logs, over 1,800 tests including a simulated browser against the real routes, regression tests confirmed by reverting each fix, and 18 decision records.

**What we are proud of.** A plan is only shown as approved when every figure matches its evidence, and an unresolved plan is shown as unresolved. In a live run of six scenarios the Skeptic sent two plans back with real objections (wrong sample sizes, unsupported ranges), and the Planner fixed them. Muse Code's bug hunts found more than thirty-five real bugs in code written before them.

**Honest limits.** The cohort behind the numbers is synthetic (484 generated engineers): the routes show how the method behaves, not how real careers go. An approved plan means the figures match their evidence, not that the advice is right. A screenshot goes to the model as it is, so crop it first. The Privacy Guard demonstrates a method on this dataset and is not a guarantee. It is a planning tool for one person, not a way to screen anyone.

**What is next.** Real, consented data in place of the synthetic cohort; voice input for What if; saving plans and scenarios; comparing plans over time.

## Built with

Meta Model API, Muse Spark (`muse-spark-1.3`), Muse Code, Next.js, React, TypeScript, Zod, Vitest, Vercel.

## Disclosures to include if the form asks

- Muse Code used in Standard mode (`muse-spark-1.3`) for tests, bug hunts and documentation. One early run (Part 2) used the contributor-mode model before the project pinned Standard mode; it only saw code that was going to be public (see ADR 0003).
- Development was AI-assisted throughout: the core of each part was written with a general-purpose AI coding assistant under the maintainer's direction, then reviewed and tested with Muse Code.
- The app stores no personal data: plans, scenarios and chat live in the browser session only, and server logs never contain request content. What a person types or uploads is sent to the Meta Model API to be read, which the screens say (typed text has emails, phone numbers and links removed first; a screenshot is sent as it is).

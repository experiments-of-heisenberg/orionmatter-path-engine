# Demo video: script and shot list

Target length: **2:50**. Record against a live deployment or `npm run dev` with your key, so Muse Spark is really called. Use
the one-click examples throughout: they are the same on the demo build, so a retake or a second machine behaves the same way.

The judging rubric is Impact, Use of Meta tooling, Technical depth and Demo, equally weighted. The script gives each a moment:
**Impact** in the hook and the privacy/share beat, **Meta tooling** in the first and last 20 seconds and in the trace, **Technical depth** in the Skeptic
and the grounded What if, **Demo** in how smooth it all is.

## Before you record

- [ ] Fresh browser profile or a clean window, 1440 by 900, zoom 100 to 110%, light mode (the map is dark either way).
- [ ] `npm run smoke -- <url> --plan` passes against the build you will record.
- [ ] Run the plan once before recording so you know how long it takes (about half a minute live).
- [ ] No `.env.local`, no terminal with a key, no Vercel settings page in any frame.
- [ ] Close notifications. Open the repo's `docs/muse-code/` page in a second tab for the last scene.

## Script

| Time         | On screen                                                                                                                                                                 | Say (about)                                                                                                                                                                                                                                                                                                                                                         |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0:00 to 0:15 | The app's first screen: the map                                                                                                                                           | "Ask a chatbot how long it takes to become Staff and it will tell you something fluent and unaccountable. Orionmatter is the opposite: three routes, each a range with the number of engineers behind it, built on Muse Spark through the Meta Model API."                                                                                                          |
| 0:15 to 0:40 | **Your story** tab. Click _Use an example story_, _Read it_. Point at the source line under two fields. Click _Use this for my routes_.                                   | "You tell it about yourself in your own words. Muse Spark reads it, and code checks every field against what you actually wrote. Each field says where it came from. Nothing is treated as verified until you confirm it."                                                                                                                                          |
| 0:40 to 1:05 | **Map** tab. Hover Climb, point at the band, the star size, the cards' ranges.                                                                                            | "Every route is a range with its sample size. The line ends in a star at the typical arrival; the soft band is the middle half; a bigger star means more engineers made it. This is synthetic data and the app says so everywhere."                                                                                                                                 |
| 1:05 to 1:40 | **What if** tab. Click _What if I want to get there within 2 years?_ Show the chips and the explanation. Drag the time slider. Show _Which limit matters most_.           | "What if is the flagship. Say it in a sentence: Muse Spark reads it, code recomputes. The explanation is written by the model and rejected unless every number in it is one the code actually computed. Sliders skip the model entirely and answer in milliseconds. Here the time limit swings the odds by more than any other limit."                              |
| 1:40 to 2:15 | **Plan** tab. Click _Build my plan_. While it runs, point at the Agent trace filling in. When done, point at the Skeptic's verdict, then the Map tab with numbered steps. | "The Planner chooses which evidence to look up, then writes three routes. The Skeptic then checks every figure: a claim with the wrong sample size, a range no evidence supports, or a promise gets sent back with the exact words. In our live audit it sent two of six plans back. Only an approved plan puts steps on your map." (Speed up the wait, or cut it.) |
| 2:15 to 2:35 | **Privacy** tab: _Use an example_, _Check with Muse Spark_. Then **Share** tab.                                                                                           | "Sharing your story is the hidden cost. The ladder shows how big a crowd you hide in as you reveal more. Muse Spark finds identifying details, but a finding counts only if its quote is really in your text. The share card then shows only what keeps you in a crowd of ten or more."                                                                             |
| 2:35 to 2:50 | The repo's `docs/muse-code/` page, then the README's judging table                                                                                                        | "We built this with Muse Code: it wrote the tests and the guides and ran a bug hunt on every part, and found more than thirty-five real bugs, each fixed with a test. The evidence is in the repo. Orionmatter: route planning that shows its work."                                                                                                                |

## What not to say

- Never "predicts", "guarantees", "will reach", "accurate" or "real data": the cohort is synthetic and every figure is a range.
- Never "on-device", "private by default" or "open weights": text goes to our server, and the model is Muse Spark through the Meta Model API.
- Never "Muse Code wrote the app": it wrote tests and documentation and reviewed the code; the core was written with an AI coding assistant under the maintainer's direction.
- Never "screens candidates": it is a planning tool for one person at a time.
- Do not stage a Skeptic rejection. If the plan is approved on the first check, say so: "approved on the first check", and mention the live audit numbers instead.

## If something goes wrong while recording

| Problem                                 | Do this                                                                         |
| --------------------------------------- | ------------------------------------------------------------------------------- |
| The plan is slow                        | Cut the wait in editing and say "about half a minute"; do not fake it           |
| The model says it is busy               | Wait ten seconds and retry the same action; the app keeps your place            |
| A sentence is refused as "not recorded" | You are on the demo build; use an example button or switch to the live build    |
| The Skeptic needs a revision            | Good. Keep it: it is real. Point at the objection and the revision in the trace |

## Shots to capture as stills (README, submission page)

1. The Map tab with the plan's steps numbered. 2. The What if tab after the 2-year example, with the chips. 3. The Agent trace after a plan. 4. The Privacy ladder.
2. The Share card. (`docs/images/map.svg` and `docs/images/trail-card.svg` are already drawn by the real components.)

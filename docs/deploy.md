# Deploying to Vercel

Two ways to run the same code, and the recommendation is to deploy **both**:

|             | Live                                                                 | Demo                                                                            |
| ----------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| What it is  | Calls Muse Spark through the Meta Model API                          | Replays recorded Muse Spark answers; never calls the model                      |
| Needs a key | Yes (`MODEL_API_KEY`)                                                | No                                                                              |
| Costs       | A few cents per plan; the key's budget                               | Nothing                                                                         |
| Can do      | Anything a visitor types                                             | The one-click examples only (anything else is refused in words)                 |
| Screen says | nothing extra                                                        | "Demo build: replaying recorded Muse Spark answers"                             |
| Use it for  | The video, the main link, judges who want to type their own sentence | The safety-net link: always fast, never out of budget, never waiting on a model |

Why both: a judge who opens the live link while the model is slow, or after the key's budget is gone, still sees a working
product on the demo link. Use two Vercel projects from the same repo (below).

## Before you start

- The repo is on GitHub and `main` passes CI (the Actions tab is green).
- You have a Meta Model API key. It is a secret: it goes only into Vercel's environment settings, never into the repo, a
  `NEXT_PUBLIC_` variable, a screenshot or a video.
- Set a spend limit or a small credit balance on the key's account if the platform allows it. The app's rate limits are a best-effort
  guard per server instance, not a global quota.

## Project 1: live

1. Vercel dashboard, **Add New Project**, import the repo. The framework is detected as Next.js. Leave the build and output settings alone.
2. **Settings, General, Node.js Version:** choose 22.x (the repo requires 20 or newer; CI uses 22).
3. **Settings, Environment Variables** (Production and Preview):

   | Name                    | Value    | Note                                                                                          |
   | ----------------------- | -------- | --------------------------------------------------------------------------------------------- |
   | `MODEL_API_KEY`         | your key | required in live mode; without it model routes return an error, and `/api/health` answers 500 |
   | `RATE_LIMIT_PER_MINUTE` | `12`     | model routes per visitor per minute per server instance; the plan route gets a third of it    |
   | `MAX_CONCURRENT_RUNS`   | `6`      | model runs at once per instance                                                               |
   | `LOG_LEVEL`             | `info`   | logs never contain request content or the key                                                 |

   Do **not** set `USE_FIXTURES` here.

4. Deploy. Open `https://<project>.vercel.app/api/health`. It should say `"mode":"live"` and `"keyConfigured":true`.
5. Verify end to end: `npm run smoke -- https://<project>.vercel.app --model`. Add `--plan` for a full plan (about half a minute, a few cents).

## Project 2: demo

1. Add a second project from the same repo (name it `<project>-demo`).
2. Environment Variables: only `USE_FIXTURES` = `true`. No key is needed and none should be set.
3. Deploy. `/api/health` should say `"mode":"fixtures"` and `"keyConfigured":false`.
4. Verify: `npm run smoke -- https://<project>-demo.vercel.app --plan`. All seven checks must pass; the plan replays in well under a second.
5. The recordings are in `src/fixtures` and are shipped with every API route by `outputFileTracingIncludes` in `next.config.ts`. If the plan check says
   `demo_only` for the default example, the fixtures did not ship: redeploy after checking that `src/fixtures` is committed.

## Function limits

The plan route allows up to 300 seconds, the What if and intake routes 120, the privacy route 60 (`maxDuration` in each route). A live
plan took 20 to 50 seconds in the evaluation. Check **Settings, Functions** for the maximum duration your Vercel plan allows;
if it is lower than a slow plan needs, the demo link is the safe one to show. The demo build is not affected.

## After deploying

- Put the live URL in the repository's **About, Website** field and in the README's first lines.
- Record the video against the live deployment or local `npm run dev` with your key (see [`demo.md`](demo.md)), not against the demo build, so the "Use of Meta tooling" is visible.
- After judging, **rotate the key** in the Meta account and delete it from Vercel.

## When something is wrong

| You see                                                                                   | Likely cause                                                         | Fix                                                                                            |
| ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Every page works but every model action says "The model is not configured on this server" | `MODEL_API_KEY` missing or empty in Production                       | Add it, redeploy                                                                               |
| `/api/health` returns 500                                                                 | Live mode without a key                                              | Add the key, or set `USE_FIXTURES=true` for a demo project                                     |
| A model action says "The model is busy" or rate limited                                   | Visitor limit or the model API is slow                               | Wait; raise `RATE_LIMIT_PER_MINUTE`; point people at the demo link                             |
| The demo says "replays recorded Muse Spark answers, and that one was not recorded"        | A sentence or text that is not one of the examples                   | Use the example buttons; this is by design                                                     |
| The demo says that for an example button                                                  | Recordings not shipped, or a prompt changed since they were recorded | `npm test` (the replay tests fail first); redo with `RECORD_FIXTURES=true npm run record:demo` |
| Build fails on Vercel but passes locally                                                  | Node version                                                         | Set Node 22.x in project settings                                                              |

# Story Computing Machine website

This repository builds the [Story Computing Machine](https://stories.rgbknights.com/) home page, library, story readers, and art gallery. The [source repository](https://github.com/BoundlessStudio/story-computing-machine) owns the writing and artwork. This repository owns the public presentation and its pinned `content/catalog.json` publication snapshot (currently 200 stories).

The homepage is a horizontal book sequence driven by the mouse wheel. Each visit selects ten distinct covers from the published catalog; the wheel opens a 9:16 edition of the supplied cover with a paper inside face, pairs each story cover with its writing prompt, then closes the last page to the left and reveals project details on the right in the same scene. The searchable grid lives at `/library/`; existing story URLs and `/art/` are preserved.

The guide API and client remain in the codebase but are not linked from the current homepage. The guide sets the reader's highest comfortable rating as starting context, asks up to four adaptive questions, and recommends three catalog stories through OpenRouter. Answers are kept in browser memory during the session and sent through the Worker to OpenRouter for each request; the Worker does not store them.

There is no category taxonomy or scheduled story classification. New stories become eligible when they are imported into `content/catalog.json` and the site is rebuilt. The guide's model ID is set by `CHAT_MODEL` in `wrangler.jsonc` (default `openai/gpt-5-mini`).

Ratings use the source collection's AO3 scale: General, Teen, Mature, and Explicit. The guide treats the reader's choice as the highest acceptable rating and filters stories on the server before asking the model to select any. `content/source.json`, `content/covers.json`, and `content/ratings-source.json` record the pinned revision, cover hashes, and rating counts. Onyx's source package does not yet have `ratings.md`; `content/rating-overrides.json` records its General rating, supported by the source editorial notes. To refresh from a reviewed source commit, run `python scripts/sync_ratings.py --repository PATH_TO_SOURCE --revision COMMIT`; pass `--add-story SLUG` for each new published story, oldest first. Refresh `content/media-index.json` from the public R2 index after its covers are published there.

## Run locally

Install Python and Node.js 24, then:

```powershell
python -m pip install -r requirements.txt
npm ci
python -m unittest discover -s tests -p 'test_*.py'
npm run check
npm run test:ts
npm run build:site
```

Run `npm run dev` to view the site at <http://127.0.0.1:8787/>. An ignored `.dev.vars` file with `OPENROUTER_API_KEY=...` is needed only for guide API requests. `npm run build:site:offline` uses the checked-in art index when working without the live index. The build uses the [R2 art index](https://art.rgbknights.com/manifests/story-computing-machine-art-v1.json) when available and falls back to `content/media-index.json`; `_site/media-source.json` records which it used.

## Deploy to Cloudflare Workers

The Worker serves the API and static `_site` assets together. It requires a Cloudflare account with the `stories.rgbknights.com` zone and a Worker secret named `OPENROUTER_API_KEY`. Never place that key in a public repository, a GitHub variable, or a client file. `wrangler.jsonc` configures a per-IP rate limit of 15 guide API calls per minute.

The `.github/workflows/worker.yml` workflow deploys a `workers.dev` preview when manually dispatched with the default `preview` target. Set the GitHub Actions secrets `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, and `OPENROUTER_API_KEY` first; the workflow uploads the last value as a Worker secret. The production deployment runs on pushes to `main` when the repository variable `CLOUDFLARE_ENABLED=true`, or through a manual `production` dispatch. The `stories.rgbknights.com` custom domain is configured in `wrangler.jsonc` and served by the Worker. GitHub Pages has been removed from this repository; `.github/workflows/site-check.yml` only builds and tests the site.

Cloudflare assets serve the existing story reader paths; the Worker handles `/` and `/api/*`. If OpenRouter is unavailable, the guide presents a link to `/library/`. The catalog and full story text are already public content; the built `guide-catalog.json` is served as a static asset.

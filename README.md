# Story Computing Machine website

This repository builds the [Story Computing Machine](https://stories.rgbknights.com/) guide, library, story readers, and art gallery. The [source repository](https://github.com/BoundlessStudio/story-computing-machine) owns the writing and artwork. This repository owns the public presentation and its pinned `content/catalog.json` publication snapshot (currently 195 stories).

The homepage is an AI story guide. It asks which ratings a reader is comfortable with, then up to four short questions. An OpenRouter model chooses a shortlist from the eligible catalog prompts, reads the shortlisted finished stories, and recommends three. The Worker joins those choices to the catalog, so the displayed writing prompts, covers, and reader URLs are exact catalog values. Answers are kept in browser memory during the session and sent through the Worker to OpenRouter for each request; the Worker does not store them. The searchable grid lives at `/library/`; existing story URLs and `/art/` are preserved.

There is no category taxonomy or scheduled story classification. New stories become eligible when they are imported into `content/catalog.json` and the site is rebuilt. The guide's model ID is set by `CHAT_MODEL` in `wrangler.jsonc` (default `openai/gpt-5-mini`).

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

Create an ignored `.dev.vars` file containing `OPENROUTER_API_KEY=...`, then run `npm run dev`. The guide is at <http://127.0.0.1:8787/>. `npm run build:site:offline` uses the checked-in art index when working without the live index. The build uses the [R2 art index](https://art.rgbknights.com/manifests/story-computing-machine-art-v1.json) when available and falls back to `content/media-index.json`; `_site/media-source.json` records which it used.

## Deploy to Cloudflare Workers

The Worker serves the API and static `_site` assets together. It requires a Cloudflare account with the `stories.rgbknights.com` zone and a Worker secret named `OPENROUTER_API_KEY`. Never place that key in a public repository, a GitHub variable, or a client file. `wrangler.jsonc` configures a per-IP rate limit of 15 guide API calls per minute.

The `.github/workflows/worker.yml` workflow deploys a `workers.dev` preview when manually dispatched with the default `preview` target. Set the GitHub Actions secrets `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, and `OPENROUTER_API_KEY` first; the workflow uploads the last value as a Worker secret. The production deployment runs on pushes to `main` when the repository variable `CLOUDFLARE_ENABLED=true`, or through a manual `production` dispatch. Remove the existing `stories` CNAME pointing to GitHub Pages during cutover; Wrangler then creates the custom domain configured in `wrangler.jsonc`. Cloudflare cannot create that custom domain while the CNAME exists. The former Pages deployment is frozen so the guide is never published without its API.

Cloudflare assets serve the existing story reader paths; the Worker handles `/` and `/api/*`. If OpenRouter is unavailable, the guide presents a link to `/library/`. The catalog and full story text are already public content; the built `guide-catalog.json` is served as a static asset.

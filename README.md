# Story Computing Machine website

This repository builds the [Story Computing Machine](https://stories.rgbknights.com/) home page, library, story readers, and art gallery. The [source repository](https://github.com/BoundlessStudio/story-computing-machine) owns the writing and artwork. This repository owns the public presentation and its pinned `content/catalog.json` publication snapshot (currently 222 stories).

The homepage is **The Long Horizon**, a scroll-driven WebGL exhibition built with three.js (vendored in `static/vendor/`). It opens on one landscape painting assembled from one tile for each of the 222 story covers. The larger portrait covers form a mosaic that crops to fill any screen size, and hover smoothly lifts and enlarges a cover; hovering names its story and clicking opens it. Cover tiles for stories created within the last 48 hours are spread through the upper rows and stand out through brighter color and warm edges. Scrolling releases the tiles and flies the camera through every story from the last 48 hours plus ten randomly chosen older stories. A single open storybook stays fixed behind the entire passage while the story art moves in front of it. The quiet parchment pages are cropped beyond the viewport without stretching, with darker areas behind the header and footer. Each stop is a location painting from that story's art files, broken into shards that lift from the open pages directly into a screen-filling landscape; the cover and prompt rise from the pages with it. Character reference sheets are reserved for the gallery and do not appear in the passage. The pieces return to the book as the camera passes. A shared book-cover-inspired location painting fills in for stories whose source package has no location art yet. Stops are ordered by the brightness of their skies, so the walk runs from morning into night and ends with the walk's covers hung beside a curator's note. Recent eligibility is calculated in the browser from `createdAt`, so it expires without a rebuild. Returning from a story restores the same walk and position. A visually hidden list of the stops keeps the walk usable from the keyboard and screen readers, and browsers without WebGL get a link to the library. The searchable grid lives at `/library/`; existing story URLs and `/art/` are preserved.

The walk's art is prepared ahead of time because the published landscapes are 3 MB PNGs and WebGL needs same-origin textures. `python scripts/sync_panorama.py [--repository PATH_TO_SOURCE]` (requires Pillow) chooses a pool of 40 stories (the newest six with landscapes plus an even spread of the rest), downloads their art from the verified media index, and writes WebP derivatives, the mosaic atlas, and cover derivatives for the newest stories to `static/panorama/` with a manifest in `content/panorama.json`. `python -m scripts.sync_story_locations [--repository PATH_TO_SOURCE]` prepares a same-story location and local cover for every story in `content/story-locations.json`, reusing the pool images and writing other derivatives to `static/story-locations/` and `static/story-covers/`. Re-run both after importing stories or new art. Location derivatives prefer paintings with a `-selected` filename suffix and place preserved `-original` paintings last.

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

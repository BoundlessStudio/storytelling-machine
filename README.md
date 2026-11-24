# Story Computing Machine website

This repository illustrates reviewed short stories and builds the [Story Computing Machine](https://stories.rgbknights.com/) home page, library, story readers, and art gallery. The writing workshop hands off reviewed prose, its rating and approved references at a particular commit. Storytelling Machine owns new illustrations and covers, the public site, and its pinned `content/catalog.json` publication snapshot. [Writing workshop](https://github.com/BoundlessStudio/story-computing-machine) · [Illustrate and import a story](#illustrate-and-import-a-story)

The homepage is **The Living Library**, a three.js reading room (vendored in `static/vendor/`). Marble shelves, a brass loom, and a walnut reading desk frame a school containing a 3D book for every published story. The books share the prepared cover atlas and move with separation, alignment, and attraction around a flowing path. Scrolling sends the current book back into the school and brings the next book onto the desk. Click the book on the desk to read the selected story. The writing prompt, story title, and rating live on the paper card on the right; up to six same-story reference studies spread across the left side of the desk. The writing and studies dissolve between selections. The [WP] label sits on the tabletop, leaving the paper available for the full prompt; its type size adjusts to fit without scrolling. The Scroll to Discover hint sits on the tabletop below the book; the room has no footer bar. Click a floating book to choose directly. Arrow keys, Page Up/Down, Space, Home/End, and vertical touch swipes also navigate. Clicking a reference opens an image viewer with keyboard navigation.

The compact school uses conservative book collision spacing and separated cover geometry to prevent intersections and depth flicker. A gentle mouse field parts nearby books, then lets them regroup. Up to six background books travel at once: each leaves its shelf, joins the school for several seconds, then settles into a reserved open slot on the opposite side. Departures are staggered, and traveling books share the school's steering and collision spacing. The room uses instanced geometry for the school and shelf books, procedural marble, and a small cache of larger cover textures for the selected book and its neighbors. Only the selected story's reference images are displayed. Text and images are projected onto world-space paper using perspective transforms, keeping the prompt readable without a WebGL text texture. Startup keeps the HTML hidden until the local art and fonts are ready and a complete 3D frame has rendered; slow or failed loading offers retry and a library link. Portrait screens arrange the card and references below the 3D scene. Every page shares the same header with a theme icon: the home room switches between white marble and black marble, while the library, gallery, and readers use matching light and dark styles. The home room motion control is hidden. The site follows the device color scheme until an explicit theme choice is saved locally; the saved choice is applied before loading to avoid a light flash and carries through navigation. Motion respects `prefers-reduced-motion`; rendering stops in hidden tabs. If WebGL is unavailable, the cover, prompt, references, and navigation remain usable. The selected story is encoded in the `?story=slug` query parameter and restored when returning from a reader. Older `#story=slug` links still work and are converted to the query format. The searchable grid lives at `/library/`; existing story URLs and `/art/` are preserved.

Gold and occasional teal glints are visible on the shelves as soon as the room appears, with bright stardust trailing the books as they begin assembling. The opening effect gradually settles into a sparse shimmer over 3.5 seconds after the last book arrives. A small, short-lived sparkle wake follows mouse movement and disappears when the pointer rests. Both effects use bounded GPU particle pools that scale with the rendering budget, match the room theme, and stop for reduced motion, paused animation, or the reference viewer.

The room uses same-origin WebP textures. Its panorama manifest in `content/panorama.json` describes the cover atlas and selected location paintings. `content/story-locations.json` points each book to its prepared cover and a same-story setting or the shared fallback. The build checks that every published book has an atlas slot and local art.

The guide API and client remain in the codebase but are not linked from the current homepage. The guide sets the reader's highest comfortable rating as starting context, asks up to four adaptive questions, and recommends three catalog stories through OpenRouter. Answers are kept in browser memory during the session and sent through the Worker to OpenRouter for each request; the Worker does not store them.

There is no category taxonomy or scheduled story classification. New stories become eligible when they are imported into `content/catalog.json` and the site is rebuilt. The guide's model ID is set by `CHAT_MODEL` in `wrangler.jsonc` (default `openai/gpt-5-mini`).

Ratings use the source collection's AO3 scale of General, Teen, Mature, and Explicit. The guide treats the reader's choice as the highest acceptable rating and filters stories on the server before asking the model to select any. `content/source.json`, `content/covers.json`, and `content/ratings-source.json` record the pinned prose revision, cover hashes, and rating counts. Onyx's source package does not yet have `ratings.md`. Its source editorial notes support the General rating recorded in `content/rating-overrides.json`.

The public gallery follows the catalog's publication snapshot and shows finished location art once. Preserved earlier images with a `-original` filename suffix are excluded, and version labels such as `Selected` are removed from public location titles. `content/art-exclusions.json` permanently removes named source paths from the gallery, homepage references, and artwork preparation, including when a refreshed upstream index still contains them.

The 3D renderer chooses a full, balanced, or economy budget from device memory/CPU hints, touch input, and WebGL limits rather than screen width. Sustained slow frames lower pixel density and shadow cost without removing any library books or changing the selected story. Constrained devices use smaller surface, reflection, atlas, and cover textures with a five-cover cache. Devices without floating-point render targets use direct lighting; devices without WebGL 2 retain the usable story fallback. Immutable room geometry is batched by material, static shadows are cached until a book or shelf slot changes, and spatial grids reduce flock neighbor and collision work. Rendering waits for the prepared assets before allocating the first complete scene frame. The performance policy in `static/library-performance.js` is versioned with the scene and covered by deterministic budget and broad-phase tests.

## Illustrate and import a story

Import the slug from the reviewed writing-repository commit. Install the Python requirements and sign in to the Codex CLI with built-in image generation available. For each approved source reference, append `--reference "SLUG/FILENAME"` using its exact name under the story's `art/references/`. A story without approved visual inputs needs only this command.

   ```powershell
   python scripts/sync_ratings.py --repository PATH_TO_SOURCE --revision COMMIT --add-story SLUG
   ```

For a new prose-only package the command starts the [illustrator agent](.codex/agents/story-title-illustrator.toml). It reads the pinned story and its rating, inspects the approved inputs, generates the people and places the story needs, then makes and checks the cover. Accepted files go in `static/story-art/SLUG/`. The [illustration workflow](.agents/skills/story-illustrate/SKILL.md) defines those deliverables. The same import prepares the gallery inputs, cover atlas and library textures before changing the catalog.

You can repeat the command after an interruption or a successful import. A published story keeps its catalog position and prompt. At the same commit, a complete, verified edition reuses its artwork without calling the illustrator. To restore a missing image, run `--add-story SLUG` at that commit. The illustrator reuses the edition's approved references, keeps the surviving artwork and generates what is missing. For an older edition whose receipt lacks the saved selection, repeat its original `--reference` arguments on the first repair. Supply the approved references again when importing a different commit. Historical packages with a matching indexed cover retain their art.

If a different published story has since been removed from the writing repository, importing a new story keeps that earlier edition at its recorded commit. The import verifies its cover digest and reuses the cover and location textures already in the site. Both source manifests record the earlier commit under `retainedStoryCommits`. A missing package named in the import still stops the command.

Run `npm run build:site:offline` for the static preview. Check the reader, gallery, library card and Living Library desk. Include the accepted art, derivatives, and manifests in the publication change. On first import of a current `story.md` package, the site displays the opening of the story and skips both `prompt.md` and `00-prompt.md`, even if they contain a writing-prompt tag. Add `--include-prompt` to publish the original request on first import. Historical `05-story.md` packages still import an opening request with a plain `[WP]` or `[SP]` tag by default. Published entries keep their existing prompts on retry and refresh.

The illustrator uses the signed-in Codex CLI. If the service rejects the configured default model before generating any image, the import retries once with the account's highest-priority visible model. To select an available model explicitly, set `STORY_ILLUSTRATOR_MODEL`. The illustrator must inspect every approved input and retained study. An incomplete review leaves the catalog in place. Logs and detailed input observations stay under `tmp/`.

The site gives its own artwork precedence at the matching story path. It serves these images alongside the site. For historical artwork it uses the verified R2 index and its checked-in snapshot. The derivative scripts can read matching legacy originals from the supplied writing checkout or fetch verified bytes. The site import supports both current `story.md` and historical `05-story.md` packages.

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

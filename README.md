# Story Computing Machine website

A small, static [story library and artwork gallery](https://boundlessstudio.github.io/storytelling-machine/) published with GitHub Pages. The [source repository](https://github.com/BoundlessStudio/story-computing-machine) owns the writing and artwork; this repository owns the public presentation.

The site retains 195 story readers from the pinned `content/catalog.json` publication snapshot. The gallery and every current cover, illustration, and comic download URL come from the [Cloudflare R2 art index](https://art.rgbknights.com/manifests/story-computing-machine-art-v1.json). At build time, `scripts/build.py` fetches that index, validates its source paths and content-addressed URLs, and makes a static `art.json`. The checked-in `content/media-index.json` is the verified initial index snapshot and keeps Pages builds possible while the source repository's index workflow is being merged or if the media host is temporarily unavailable. `media-source.json` in the built site records whether the public or snapshot index was used.

The index contains art and PDF URLs, not story prose. New stories need a deliberate prose import into `content/catalog.json` before they get library readers; artwork for stories not yet in that catalog links to its source package. The old snapshot files in `content/` also supply captions and matching optimized gallery thumbnails where their source hashes still agree with the new index. Supplied reference images and excluded paintings do not appear in the index or gallery.

## Run locally

```powershell
python -m pip install -r requirements.txt
python -m unittest discover -s tests -p 'test_*.py'
python scripts/build.py --output _site --base-path / --site-url http://127.0.0.1:8765
cd _site
python -m http.server 8765
```

Open <http://127.0.0.1:8765/>. Use `--offline` to build from the checked-in index snapshot. Artwork needs an internet connection to the public media host.

## Deploy

The Pages workflow builds on pull requests and deploys on `main`, manual dispatch, or its daily refresh. The repository's Pages build source must be **GitHub Actions**. The default URL is <https://boundlessstudio.github.io/storytelling-machine/>.

For a custom domain, set Actions variables `SITE_ORIGIN` to its HTTPS origin and `SITE_BASE_PATH` to `/`, then configure the domain in GitHub Pages. `MEDIA_INDEX_URL` can override the R2 index endpoint. No Node or Three.js build is needed.

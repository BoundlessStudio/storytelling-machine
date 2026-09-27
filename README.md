# Story Computing Machine website

A static library for the published Story Computing Machine stories and artwork. The site includes a searchable story index, 195 reader pages, an artwork gallery, selected illustrated scenes, and links to the published graphic-novel PDFs.

The [story repository](https://github.com/BoundlessStudio/story-computing-machine) owns the writing and art. This repository owns presentation. `content/` is a pinned copy of the last publication snapshots before the story repository retired its Pages machinery in [the editorial-workshop cleanup](https://github.com/BoundlessStudio/story-computing-machine/commit/16ad4fc683f907d0267fae2a7872a72340cd7688). The pinned source commit is recorded in `content/source.json`. Published images and PDFs use their content hashes on `art.rgbknights.com`, keeping this website small while preserving the selected media bytes.

## Run locally

```powershell
python -m pip install -r requirements.txt
python scripts/build.py --output _site --base-path / --site-url http://127.0.0.1:8765
cd _site
python -m http.server 8765
```

Open <http://127.0.0.1:8765/>. Artwork needs an internet connection to the public media host.

## Deploy

The Pages workflow builds on pull requests and deploys when `main` changes. In this repository's GitHub settings, choose **GitHub Actions** as the Pages build source. The default URL is `https://boundlessstudio.github.io/storytelling-machine/`.

For a custom domain, set repository Actions variables `SITE_ORIGIN` to the HTTPS origin (for example, `https://stories.example.com`) and `SITE_BASE_PATH` to `/`. Add the domain in GitHub Pages settings and point DNS to GitHub Pages. `MEDIA_ORIGIN` defaults to `https://art.rgbknights.com` and can be changed if the media host moves.

## Content updates

The initial migration can be reproduced from the preserved pre-cleanup revision:

```powershell
python scripts/sync_content.py --repository ../story-computing-machine --revision d9c6d2939e675c685225daf9d305e02f5675414e
python scripts/build.py
```

`sync_content.py` only accepts revisions containing the former `pages/` publication snapshots. Current `story-computing-machine/main` has no such snapshots. New stories and changes to existing stories need an explicit publishing import from that editorial repository before they appear here; a rebuild alone intentionally keeps the pinned publication unchanged. Preserve the published prompt wording and selected art when implementing that import.

## Checks

```powershell
python -m unittest discover -s tests -p 'test_*.py'
```

The build emits static HTML, CSS, JavaScript, `art.json`, `sitemap.xml`, and redirects for former `stories/<slug>.html` links. No runtime server or browser framework is required.

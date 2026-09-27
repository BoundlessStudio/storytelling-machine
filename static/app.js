(function () {
  const root = document.documentElement;
  const themeButton = document.getElementById('theme-button');
  if (themeButton) {
    themeButton.addEventListener('click', () => {
      root.dataset.theme = root.dataset.theme === 'light' ? 'dark' : 'light';
      try { localStorage.setItem('scm-theme', root.dataset.theme); } catch (_) { /* storage is optional */ }
    });
  }

  const atlasIndex = document.getElementById('atlas-index');
  if (atlasIndex) {
    const search = document.getElementById('story-search');
    const rating = document.getElementById('rating-filter');
    const status = document.getElementById('story-results');
    const empty = document.getElementById('story-empty');
    const layout = document.getElementById('library');
    const stage = document.getElementById('atlas-stage');
    const scene = document.getElementById('atlas-scene');
    const toggle = document.getElementById('view-toggle');
    const random = document.getElementById('random-story');
    const entries = Array.from(atlasIndex.querySelectorAll('[data-story-entry]'));
    const stories = entries.map(entry => ({
      slug: entry.dataset.slug, title: entry.dataset.title, created: entry.dataset.created,
      rating: entry.dataset.rating, cover: entry.dataset.cover, excerpt: entry.dataset.excerpt,
      search: entry.dataset.search, url: entry.href
    }));
    const months = Array.from(atlasIndex.querySelectorAll('[data-index-month]'));
    const detailCover = document.getElementById('atlas-cover');
    const detailTitle = document.getElementById('atlas-detail-title');
    const detailKicker = document.getElementById('atlas-detail-kicker');
    const detailExcerpt = document.getElementById('atlas-detail-excerpt');
    const detailRead = document.getElementById('atlas-read');
    const detailArt = document.getElementById('atlas-art');
    const position = document.getElementById('atlas-position');
    const archiveCode = document.getElementById('atlas-archive-code');
    const newer = document.getElementById('atlas-newer');
    const older = document.getElementById('atlas-older');
    const artUrl = document.querySelector('.atlas-intro-links a').href;
    let selected = 0;
    let visible = entries.map((_, index) => index);
    let engine = null;
    let loading = false;
    let flat = false;

    function updateUrl() {
      const params = new URLSearchParams();
      if (search.value.trim()) params.set('q', search.value.trim());
      if (rating.value !== 'all') params.set('rating', rating.value);
      if (selected !== 0) params.set('card', stories[selected].slug);
      history.replaceState(null, '', location.pathname + (params.size ? '?' + params : '') + location.hash);
    }

    function select(index, focus = false, updateHistory = true) {
      if (!visible.includes(index)) return;
      selected = index;
      const story = stories[index];
      entries.forEach((entry, i) => {
        entry.classList.toggle('is-selected', i === index);
        entry.tabIndex = i === index ? 0 : -1;
      });
      detailCover.src = story.cover;
      detailCover.alt = `Cover for ${story.title}`;
      detailTitle.textContent = story.title;
      detailKicker.textContent = `CARD ${String(index + 1).padStart(3, '0')} · ${story.created} · ${story.rating}`;
      detailExcerpt.textContent = story.excerpt;
      detailRead.href = story.url;
      detailArt.href = artUrl + '?story=' + encodeURIComponent(story.slug);
      position.textContent = `${String(index + 1).padStart(3, '0')} / ${String(stories.length).padStart(3, '0')}`;
      archiveCode.textContent = `SCM — ARCHIVE / ${String(index + 1).padStart(3, '0')}`;
      newer.disabled = !visible.some(value => value < index);
      older.disabled = !visible.some(value => value > index);
      const row = entries[index];
      if (row.offsetTop < atlasIndex.scrollTop) atlasIndex.scrollTop = row.offsetTop;
      else if (row.offsetTop + row.offsetHeight > atlasIndex.scrollTop + atlasIndex.clientHeight) {
        atlasIndex.scrollTop = row.offsetTop + row.offsetHeight - atlasIndex.clientHeight;
      }
      if (focus) entries[index].focus({ preventScroll: true });
      if (engine) engine.select(index);
      if (updateHistory) updateUrl();
    }

    function updateFilters(updateHistory = true) {
      const query = search.value.trim().toLocaleLowerCase();
      visible = [];
      entries.forEach((entry, index) => {
        const show = (rating.value === 'all' || stories[index].rating === rating.value) &&
          (!query || stories[index].search.includes(query));
        entry.hidden = !show;
        if (show) visible.push(index);
      });
      months.forEach(heading => {
        let next = heading.nextElementSibling;
        let hasStory = false;
        while (next && !next.matches('[data-index-month]')) {
          if (!next.hidden) hasStory = true;
          next = next.nextElementSibling;
        }
        heading.hidden = !hasStory;
      });
      status.textContent = `${visible.length} ${visible.length === 1 ? 'story' : 'stories'} found`;
      empty.hidden = visible.length !== 0;
      stage.classList.toggle('no-results', visible.length === 0);
      if (engine) engine.setMatches(visible);
      if (visible.length) select(visible.includes(selected) ? selected : visible[0], false, false);
      else { newer.disabled = true; older.disabled = true; }
      if (updateHistory) updateUrl();
    }

    function setFlat(value) {
      flat = value;
      layout.classList.toggle('is-flat', flat);
      toggle.textContent = flat ? '3D view' : 'Flat view';
      toggle.setAttribute('aria-pressed', String(flat));
      try { localStorage.setItem('scm-flat-view', flat ? '1' : '0'); } catch (_) { /* optional */ }
      if (!flat && !engine) loadEngine();
    }

    async function loadEngine() {
      if (loading || engine || flat) return;
      loading = true;
      try {
        const test = document.createElement('canvas');
        if (!test.getContext('webgl2')) throw new Error('WebGL 2 is unavailable');
        const module = await import('./engine.js');
        if (flat) return;
        engine = module.createEngine({
          element: scene, stories, initialIndex: selected,
          reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
          onSelect: index => select(index),
          onFailure: () => {
            stage.classList.remove('has-webgl');
            toggle.hidden = true;
            setFlat(true);
          }
        });
        engine.setMatches(visible);
        stage.classList.add('has-webgl');
      } catch (_) {
        toggle.hidden = true;
        layout.classList.add('is-flat');
      } finally {
        loading = false;
      }
    }

    const params = new URLSearchParams(location.search);
    search.value = params.get('q') || '';
    if (Array.from(rating.options).some(option => option.value === params.get('rating'))) rating.value = params.get('rating');
    updateFilters(false);
    const linked = stories.findIndex(story => story.slug === params.get('card'));
    if (linked >= 0 && visible.includes(linked)) select(linked, false, false);
    else if (visible.length) select(visible[0], false, false);
    search.addEventListener('input', () => updateFilters());
    rating.addEventListener('input', () => updateFilters());
    entries.forEach((entry, index) => {
      entry.addEventListener('mouseenter', () => { if (visible.includes(index)) select(index); });
      entry.addEventListener('focus', () => { if (visible.includes(index)) select(index); });
    });
    atlasIndex.addEventListener('keydown', event => {
      if (!visible.length) return;
      const current = visible.indexOf(selected);
      let next = -1;
      if (event.key === 'ArrowDown') next = Math.min(visible.length - 1, current + 1);
      else if (event.key === 'ArrowUp') next = Math.max(0, current - 1);
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = visible.length - 1;
      else if (event.key === 'PageDown') next = Math.min(visible.length - 1, current + 12);
      else if (event.key === 'PageUp') next = Math.max(0, current - 12);
      if (next >= 0) {
        event.preventDefault();
        select(visible[next], true);
      }
    });
    random.addEventListener('click', () => {
      if (!visible.length) return;
      const choices = visible.filter(index => index !== selected);
      select((choices.length ? choices : visible)[Math.floor(Math.random() * (choices.length || visible.length))]);
    });
    newer.addEventListener('click', () => {
      const previous = visible.filter(index => index < selected).pop();
      if (previous !== undefined) select(previous);
    });
    older.addEventListener('click', () => {
      const next = visible.find(index => index > selected);
      if (next !== undefined) select(next);
    });
    toggle.addEventListener('click', () => setFlat(!flat));
    document.addEventListener('keydown', event => {
      if (event.altKey || event.ctrlKey || event.metaKey || /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) return;
      if (event.key === '/') { event.preventDefault(); search.focus(); }
      if (event.key.toLowerCase() === 'r') random.click();
    });
    addEventListener('popstate', () => {
      const state = new URLSearchParams(location.search);
      search.value = state.get('q') || '';
      rating.value = Array.from(rating.options).some(option => option.value === state.get('rating')) ? state.get('rating') : 'all';
      updateFilters(false);
      const index = stories.findIndex(story => story.slug === state.get('card'));
      if (visible.length) select(index >= 0 && visible.includes(index) ? index : visible[0], false, false);
    });
    try { flat = localStorage.getItem('scm-flat-view') === '1' || navigator.connection?.saveData === true; } catch (_) { flat = false; }
    setFlat(flat);
    if (!flat) {
      if ('requestIdleCallback' in window) requestIdleCallback(loadEngine, { timeout: 1200 });
      else setTimeout(loadEngine, 200);
    };
  }

  const artSection = document.querySelector('[data-art-json]');
  if (!artSection) return;
  const search = document.getElementById('art-search');
  const type = document.getElementById('art-type');
  const story = document.getElementById('art-story');
  const grid = document.getElementById('art-grid');
  const status = document.getElementById('art-results');
  const empty = document.getElementById('art-empty');
  const more = document.getElementById('art-more');
  const dialog = document.getElementById('art-dialog');
  const dialogImage = document.getElementById('dialog-image');
  const dialogTitle = document.getElementById('dialog-title');
  const dialogType = document.getElementById('dialog-type');
  const dialogStory = document.getElementById('dialog-story');
  const dialogReader = document.getElementById('dialog-reader');
  const close = document.getElementById('dialog-close');
  const batchSize = 48;
  let all = [];
  let filtered = [];
  let shown = 0;

  function openArtwork(item) {
    dialogImage.src = item.full;
    dialogImage.alt = item.alt;
    dialogTitle.textContent = item.title;
    dialogType.textContent = item.type;
    dialogStory.textContent = item.story;
    dialogReader.href = item.reader;
    dialog.showModal();
  }
  close.addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
  dialog.addEventListener('close', () => { dialogImage.removeAttribute('src'); });

  function card(item) {
    const article = document.createElement('article');
    article.className = 'art-card';
    const button = document.createElement('button');
    button.type = 'button';
    button.setAttribute('aria-label', `View ${item.title}, ${item.type} for ${item.story}`);
    const image = document.createElement('img');
    image.src = item.thumbnail;
    image.alt = item.alt;
    image.loading = 'lazy';
    image.decoding = 'async';
    const copy = document.createElement('span');
    copy.className = 'art-card-copy';
    const category = document.createElement('small');
    category.textContent = item.type;
    const title = document.createElement('strong');
    title.textContent = item.title;
    const source = document.createElement('em');
    source.textContent = item.story;
    copy.append(category, title, source);
    button.append(image, copy);
    button.addEventListener('click', () => openArtwork(item));
    article.appendChild(button);
    return article;
  }
  function showMore() {
    const next = filtered.slice(shown, shown + batchSize);
    const fragment = document.createDocumentFragment();
    next.forEach(item => fragment.appendChild(card(item)));
    grid.appendChild(fragment);
    shown += next.length;
    more.hidden = shown >= filtered.length;
  }
  function update() {
    const query = search.value.trim().toLocaleLowerCase();
    filtered = all.filter(item =>
      (type.value === 'all' || item.type === type.value) &&
      (story.value === 'all' || item.slug === story.value) &&
      (!query || `${item.title} ${item.story} ${item.alt}`.toLocaleLowerCase().includes(query))
    );
    grid.replaceChildren();
    shown = 0;
    status.textContent = `${filtered.length.toLocaleString()} ${filtered.length === 1 ? 'artwork' : 'artworks'} found`;
    empty.hidden = filtered.length !== 0;
    showMore();
    const params = new URLSearchParams();
    if (type.value !== 'all') params.set('type', type.value);
    if (story.value !== 'all') params.set('story', story.value);
    history.replaceState(null, '', location.pathname + (params.size ? '?' + params : ''));
  }
  more.addEventListener('click', showMore);
  [search, type, story].forEach(control => control.addEventListener('input', update));
  fetch(artSection.dataset.artJson)
    .then(response => { if (!response.ok) throw new Error('Could not load artwork'); return response.json(); })
    .then(items => {
      all = items;
      const stories = new Map(items.map(item => [item.slug, item.story]));
      Array.from(stories.entries()).sort((a, b) => a[1].localeCompare(b[1])).forEach(([slug, title]) => {
        const option = document.createElement('option');
        option.value = slug;
        option.textContent = title;
        story.appendChild(option);
      });
      const params = new URLSearchParams(location.search);
      if (params.has('story') && stories.has(params.get('story'))) story.value = params.get('story');
      if (params.has('type') && Array.from(type.options).some(option => option.value === params.get('type'))) type.value = params.get('type');
      update();
    })
    .catch(() => { status.textContent = 'Artwork could not be loaded. Please refresh the page.'; });
})();

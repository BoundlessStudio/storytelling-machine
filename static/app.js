(() => {
  const deviceTheme = matchMedia('(prefers-color-scheme: dark)');
  const themeKey = 'living-library-theme';
  const themeButtons = [...document.querySelectorAll('[data-theme-toggle]')];
  let themeSaved = false;
  function savedTheme() {
    try {
      const saved = localStorage.getItem(themeKey);
      return saved === 'light' || saved === 'dark' ? saved : null;
    } catch { return null; }
  }
  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    themeButtons.forEach(button => {
      const label = theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';
      button.setAttribute('aria-pressed', String(theme === 'dark'));
      button.setAttribute('aria-label', label); button.title = label;
    });
    window.dispatchEvent(new CustomEvent('site-theme-change', { detail: { theme } }));
  }
  themeSaved = savedTheme() !== null;
  applyTheme(document.documentElement.dataset.theme || (deviceTheme.matches ? 'dark' : 'light'));
  themeButtons.forEach(button => button.addEventListener('click', () => {
    themeSaved = true;
    const theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    applyTheme(theme);
    try { localStorage.setItem(themeKey, theme); } catch { /* The device remains the fallback on reload. */ }
  }));
  deviceTheme.addEventListener('change', event => { if (!themeSaved) applyTheme(event.matches ? 'dark' : 'light'); });
  window.addEventListener('storage', event => {
    if (event.key !== themeKey && event.key !== null) return;
    const saved = savedTheme(); themeSaved = saved !== null;
    applyTheme(saved || (deviceTheme.matches ? 'dark' : 'light'));
  });
  window.addEventListener('pageshow', event => {
    if (!event.persisted) return;
    const saved = savedTheme(); themeSaved = saved !== null;
    applyTheme(saved || (deviceTheme.matches ? 'dark' : 'light'));
  });

  const storySearch = document.getElementById('story-search');
  if (storySearch) {
    const ratingButtons = [...document.querySelectorAll('[data-rating-filter]')];
    const ratingNames = ratingButtons.map(button => button.dataset.ratingFilter);
    const defaultRatings = ratingNames.filter(rating => rating !== 'Explicit');
    const explicitWarning = document.getElementById('explicit-warning');
    const explicitKey = 'story-library-explicit-acknowledged';
    let explicitAcknowledged = false;
    function hasExplicitAcknowledgement() {
      try { explicitAcknowledged ||= localStorage.getItem(explicitKey) === 'true'; } catch { /* Keep the in-page acknowledgement. */ }
      return explicitAcknowledged;
    }
    const cards = [...document.querySelectorAll('[data-story-card]')];
    const results = document.getElementById('story-results');
    const empty = document.getElementById('story-empty');
    const params = new URLSearchParams(location.search);
    storySearch.value = params.get('q') || '';
    const requestedRatings = params.getAll('rating').flatMap(value => value.split(','));
    const validRatings = ratingNames.filter(rating => requestedRatings.includes(rating));
    const selectedRatings = new Set(requestedRatings.includes('all') ? ratingNames
      : validRatings.length ? validRatings : requestedRatings.includes('none') ? [] : defaultRatings);
    const warnOnLoad = selectedRatings.has('Explicit') && !hasExplicitAcknowledgement();
    if (warnOnLoad) selectedRatings.delete('Explicit');

    function warnAboutExplicit() {
      explicitWarning.returnValue = '';
      explicitWarning.showModal();
    }
    function filterStories(updateUrl = true) {
      const query = storySearch.value.trim().toLocaleLowerCase();
      let visible = 0;
      cards.forEach(card => {
        const show = (!query || card.dataset.search.includes(query)) &&
          selectedRatings.has(card.dataset.rating);
        card.hidden = !show;
        if (show) visible += 1;
      });
      results.textContent = `${visible} ${visible === 1 ? 'story' : 'stories'}`;
      empty.hidden = visible !== 0;
      ratingButtons.forEach(button => button.setAttribute('aria-pressed', String(selectedRatings.has(button.dataset.ratingFilter))));
      if (updateUrl) {
        const next = new URLSearchParams();
        if (storySearch.value.trim()) next.set('q', storySearch.value.trim());
        const activeRatings = ratingNames.filter(rating => selectedRatings.has(rating));
        if (activeRatings.length !== defaultRatings.length || defaultRatings.some(rating => !selectedRatings.has(rating))) {
          next.set('rating', activeRatings.join(',') || 'none');
        }
        history.replaceState(null, '', location.pathname + (next.size ? `?${next}` : ''));
      }
    }
    storySearch.addEventListener('input', () => filterStories());
    ratingButtons.forEach(button => button.addEventListener('click', () => {
      const rating = button.dataset.ratingFilter;
      if (selectedRatings.has(rating)) selectedRatings.delete(rating);
      else if (rating === 'Explicit' && !hasExplicitAcknowledgement()) {
        warnAboutExplicit();
        return;
      } else selectedRatings.add(rating);
      filterStories();
    }));
    explicitWarning.addEventListener('close', () => {
      if (explicitWarning.returnValue !== 'confirm') return;
      explicitAcknowledged = true;
      try { localStorage.setItem(explicitKey, 'true'); } catch { /* Acknowledge for this page when storage is unavailable. */ }
      selectedRatings.add('Explicit');
      filterStories();
    });
    explicitWarning.addEventListener('click', event => {
      if (event.target !== explicitWarning) return;
      const bounds = explicitWarning.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right ||
          event.clientY < bounds.top || event.clientY > bounds.bottom) explicitWarning.close('cancel');
    });
    filterStories(params.has('rating'));
    if (warnOnLoad) warnAboutExplicit();
  }

  const section = document.querySelector('[data-art-json]');
  if (!section) return;
  const search = document.getElementById('art-search');
  const typeButtons = [...document.querySelectorAll('[data-art-type]')];
  const results = document.getElementById('art-results');
  const grid = document.getElementById('art-grid');
  const empty = document.getElementById('art-empty');
  const sentinel = document.getElementById('art-sentinel');
  const more = document.getElementById('art-more');
  const dialog = document.getElementById('art-dialog');
  const dialogImage = document.getElementById('dialog-image');
  let artwork = [];
  let matches = [];
  let shown = 0;
  const pageSize = 24;
  const params = new URLSearchParams(location.search);
  const typeAliases = {
    Landscapes: 'Locations',
    Interiors: 'Locations',
    'Landscapes & interiors': 'Locations',
  };
  const requestedType = params.get('type');
  const initialType = typeAliases[requestedType] || requestedType;
  let selectedType = typeButtons.some(button => button.dataset.artType === initialType) ? initialType : 'all';
  let selectedStory = params.get('story') || 'all';
  search.value = params.get('q') || '';

  function updateTypeButtons() {
    typeButtons.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.artType === selectedType)));
  }
  updateTypeButtons();

  function setUrl() {
    const params = new URLSearchParams();
    if (search.value.trim()) params.set('q', search.value.trim());
    if (selectedType !== 'all') params.set('type', selectedType);
    if (selectedStory !== 'all') params.set('story', selectedStory);
    history.replaceState(null, '', location.pathname + (params.size ? `?${params}` : ''));
  }

  function openArt(item) {
    dialogImage.src = item.full;
    dialogImage.alt = item.alt;
    document.getElementById('dialog-type').textContent = item.type;
    document.getElementById('dialog-title').textContent = item.title;
    document.getElementById('dialog-story').textContent = item.story;
    const reader = document.getElementById('dialog-reader');
    reader.href = item.reader;
    reader.textContent = item.reader.includes('github.com/') ? 'View story source ↗' : 'Read the story ↗';
    document.getElementById('dialog-original').href = item.full;
    dialog.showModal();
  }

  function addArt() {
    const end = Math.min(shown + pageSize, matches.length);
    const fragment = document.createDocumentFragment();
    for (; shown < end; shown += 1) {
      const item = matches[shown];
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'art-card';
      button.setAttribute('aria-label', `View ${item.title} from ${item.story}`);
      const frame = document.createElement('span');
      frame.className = 'art-frame';
      const image = document.createElement('img');
      image.src = item.thumbnail;
      image.alt = '';
      image.loading = 'lazy';
      image.decoding = 'async';
      frame.append(image);
      const copy = document.createElement('span');
      copy.className = 'art-copy';
      const title = document.createElement('strong');
      title.textContent = item.title;
      const detail = document.createElement('small');
      detail.textContent = `${item.story} · ${item.type}`;
      copy.append(title, detail);
      button.append(frame, copy);
      button.addEventListener('click', () => openArt(item));
      fragment.append(button);
    }
    grid.append(fragment);
    const hasMore = shown < matches.length;
    sentinel.hidden = !observer || !hasMore;
    more.hidden = !!observer || !hasMore;
  }

  const observer = 'IntersectionObserver' in window
    ? new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) addArt();
    }, { rootMargin: '700px 0px' })
    : null;
  if (observer) observer.observe(sentinel);

  function filterArt(updateUrl = true) {
    const query = search.value.trim().replace(/\s+/g, ' ').toLocaleLowerCase();
    matches = artwork.filter(item =>
      (selectedType === 'all' || item.type === selectedType) &&
      (selectedStory === 'all' || item.slug === selectedStory) &&
      (!query || item.searchText.includes(query))
    );
    updateTypeButtons();
    shown = 0;
    grid.replaceChildren();
    results.textContent = `${matches.length} ${matches.length === 1 ? 'image' : 'images'}`;
    empty.hidden = matches.length !== 0;
    addArt();
    if (updateUrl) setUrl();
  }

  more.addEventListener('click', addArt);
  document.getElementById('dialog-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
  dialog.addEventListener('close', () => { dialogImage.removeAttribute('src'); });
  search.addEventListener('input', () => filterArt());
  typeButtons.forEach(button => button.addEventListener('click', () => {
    selectedType = button.dataset.artType;
    filterArt();
  }));

  fetch(section.dataset.artJson)
    .then(response => { if (!response.ok) throw new Error(`HTTP ${response.status}`); return response.json(); })
    .then(data => {
      if (!Array.isArray(data)) throw new Error('Invalid artwork data');
      artwork = data.map(item => ({
        ...item,
        searchText: `${item.title} ${item.story} ${item.prompt || ''} ${item.type}`.replace(/\s+/g, ' ').toLocaleLowerCase(),
      }));
      if (!artwork.some(item => item.slug === selectedStory)) selectedStory = 'all';
      filterArt(Boolean(typeAliases[requestedType]));
    })
    .catch(() => { results.textContent = 'The gallery could not load. Please try again shortly.'; });
})();

(() => {
  const storySearch = document.getElementById('story-search');
  if (storySearch) {
    const rating = document.getElementById('rating-filter');
    const cards = [...document.querySelectorAll('[data-story-card]')];
    const results = document.getElementById('story-results');
    const empty = document.getElementById('story-empty');
    const params = new URLSearchParams(location.search);
    storySearch.value = params.get('q') || '';
    if ([...rating.options].some(option => option.value === params.get('rating'))) {
      rating.value = params.get('rating');
    }
    function filterStories(updateUrl = true) {
      const query = storySearch.value.trim().toLocaleLowerCase();
      let visible = 0;
      cards.forEach(card => {
        const show = (!query || card.dataset.search.includes(query)) &&
          (rating.value === 'all' || card.dataset.rating === rating.value);
        card.hidden = !show;
        if (show) visible += 1;
      });
      results.textContent = `${visible} ${visible === 1 ? 'story' : 'stories'}`;
      empty.hidden = visible !== 0;
      if (updateUrl) {
        const next = new URLSearchParams();
        if (storySearch.value.trim()) next.set('q', storySearch.value.trim());
        if (rating.value !== 'all') next.set('rating', rating.value);
        history.replaceState(null, '', location.pathname + (next.size ? `?${next}` : ''));
      }
    }
    storySearch.addEventListener('input', () => filterStories());
    rating.addEventListener('change', () => filterStories());
    filterStories(false);
  }

  const section = document.querySelector('[data-art-json]');
  if (!section) return;
  const search = document.getElementById('art-search');
  const type = document.getElementById('art-type');
  const story = document.getElementById('art-story');
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

  function setUrl() {
    const params = new URLSearchParams();
    if (search.value.trim()) params.set('q', search.value.trim());
    if (type.value !== 'all') params.set('type', type.value);
    if (story.value !== 'all') params.set('story', story.value);
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
    const query = search.value.trim().toLocaleLowerCase();
    matches = artwork.filter(item =>
      (type.value === 'all' || item.type === type.value) &&
      (story.value === 'all' || item.slug === story.value) &&
      (!query || `${item.title} ${item.story} ${item.type}`.toLocaleLowerCase().includes(query))
    );
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
  type.addEventListener('change', () => filterArt());
  story.addEventListener('change', () => filterArt());

  fetch(section.dataset.artJson)
    .then(response => { if (!response.ok) throw new Error(`HTTP ${response.status}`); return response.json(); })
    .then(data => {
      if (!Array.isArray(data)) throw new Error('Invalid artwork data');
      artwork = data;
      const names = new Map();
      artwork.forEach(item => names.set(item.slug, item.story));
      [...names].sort((a, b) => a[1].localeCompare(b[1])).forEach(([slug, title]) => {
        const option = document.createElement('option');
        option.value = slug;
        option.textContent = title;
        story.append(option);
      });
      const params = new URLSearchParams(location.search);
      search.value = params.get('q') || '';
      const typeAliases = {
        Landscapes: 'Landscapes & interiors',
        Interiors: 'Landscapes & interiors',
        'Edition covers': 'Covers',
        'Comic covers': 'Comics',
        'Comic pages': 'Comics',
      };
      const requestedType = params.get('type');
      const selectedType = typeAliases[requestedType] || requestedType;
      if ([...type.options].some(option => option.value === selectedType)) type.value = selectedType;
      if (names.has(params.get('story'))) story.value = params.get('story');
      filterArt(Boolean(typeAliases[requestedType]));
    })
    .catch(() => { results.textContent = 'The gallery could not load. Please try again shortly.'; });
})();

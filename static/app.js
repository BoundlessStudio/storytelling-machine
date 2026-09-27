(function () {
  const root = document.documentElement;
  const themeButton = document.getElementById('theme-button');
  if (themeButton) {
    themeButton.addEventListener('click', () => {
      root.dataset.theme = root.dataset.theme === 'light' ? 'dark' : 'light';
      try { localStorage.setItem('scm-theme', root.dataset.theme); } catch (_) { /* storage is optional */ }
    });
  }

  const storyGrid = document.getElementById('story-grid');
  if (storyGrid) {
    const search = document.getElementById('story-search');
    const rating = document.getElementById('rating-filter');
    const sort = document.getElementById('story-sort');
    const status = document.getElementById('story-results');
    const empty = document.getElementById('story-empty');
    const cards = Array.from(storyGrid.querySelectorAll('[data-story-card]'));
    const update = () => {
      const query = search.value.trim().toLocaleLowerCase();
      const visible = cards.filter(card =>
        (!query || card.dataset.search.includes(query)) &&
        (rating.value === 'all' || card.dataset.rating === rating.value)
      );
      const ordered = [...cards].sort((a, b) => {
        if (sort.value === 'title') return a.dataset.title.localeCompare(b.dataset.title);
        const date = a.dataset.created.localeCompare(b.dataset.created);
        return sort.value === 'oldest' ? date : -date;
      });
      ordered.forEach(card => { card.hidden = !visible.includes(card); storyGrid.appendChild(card); });
      status.textContent = `${visible.length} ${visible.length === 1 ? 'story' : 'stories'} found`;
      empty.hidden = visible.length !== 0;
    };
    [search, rating, sort].forEach(control => control.addEventListener('input', update));
    update();
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

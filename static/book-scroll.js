(() => {
  const home = document.querySelector('.scroll-home');
  if (!home) return;

  const track = document.getElementById('main');
  const book = document.getElementById('scroll-book');
  const left = document.getElementById('scroll-left');
  const right = document.getElementById('scroll-right');
  const opening = document.getElementById('scroll-opening');
  const openingBack = document.getElementById('scroll-opening-back');
  const turn = document.getElementById('scroll-turn');
  const front = document.getElementById('scroll-turn-front');
  const ending = document.getElementById('scroll-ending');
  const endingFront = document.getElementById('scroll-ending-front');
  const details = document.getElementById('scroll-details');
  const read = document.getElementById('scroll-read');
  const intro = document.getElementById('scroll-intro');
  const scene = document.getElementById('scroll-scene');
  const end = document.getElementById('about');
  const bookmarkRail = document.getElementById('scroll-bookmarks');
  const bookmarkHost = bookmarkRail.parentElement;
  const bookmarkList = document.getElementById('scroll-bookmarks-list');
  const bookmarkHint = document.getElementById('scroll-bookmark-hint');
  const bookmarkReturn = document.getElementById('scroll-bookmark-return');
  const mobile = matchMedia('(max-width: 600px)');
  const portraitPhone = matchMedia('(max-width: 600px) and (orientation: portrait)');
  const compactPortrait = matchMedia('(max-width: 600px) and (orientation: portrait) and (min-aspect-ratio: 53/100)');
  const landscapePhone = matchMedia('(orientation: landscape) and (max-width: 1000px) and (max-height: 600px)');
  const mobileStory = document.getElementById('mobile-story');
  const mobileBackdrop = document.getElementById('mobile-art-backdrop');
  const mobileCover = document.getElementById('mobile-cover');
  const mobileFrontCover = mobileCover.getAttribute('src');
  const mobileBookmarkReturn = document.getElementById('mobile-bookmark-return');
  const mobileSideCopy = document.getElementById('mobile-side-copy');
  const mobileOverlayCopy = document.getElementById('mobile-overlay-copy');
  const mobileSideRead = document.getElementById('mobile-side-read');
  const mobileOverlayRead = document.getElementById('mobile-overlay-read');
  const mobileToggle = document.getElementById('mobile-wp-toggle');
  const mobileOverlay = document.getElementById('mobile-prompt-overlay');
  const mobileClose = document.getElementById('mobile-prompt-close');
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  let stories = [];
  let feed = [];
  let frame = 0;
  let activeIndex = -1;
  let bookmarkedStory = null;
  let bookmarkOpenFromCover = false;
  let bookmarkTimer = 0;
  let bookmarkSignature = '';
  let overlayOpen = false;
  let lastPhoneStep = 0;
  let lastPhoneMode = portraitPhone.matches ? 'portrait' : landscapePhone.matches ? 'landscape' : 'desktop';

  const isPhone = () => portraitPhone.matches || landscapePhone.matches;

  function positionBookmarks() {
    if (bookmarkRail.hidden) return;
    const viewport = bookmarkRail.parentElement.getBoundingClientRect();
    if (isPhone()) {
      const topInset = landscapePhone.matches || compactPortrait.matches ? 38 : 0;
      const coverWidth = Math.min(viewport.width, (viewport.height - topInset) * 9 / 16);
      const coverHeight = coverWidth * 16 / 9;
      const coverLeft = (viewport.width - coverWidth) / 2;
      const coverTop = topInset + (viewport.height - topInset - coverHeight) / 2;
      bookmarkRail.style.left = `${coverLeft + 8}px`;
      bookmarkRail.style.top = `${Math.max(4, coverTop - 35)}px`;
      bookmarkRail.style.width = `${coverWidth - 16}px`;
      bookmarkRail.classList.toggle('is-overflowing', bookmarkList.scrollWidth > bookmarkList.clientWidth + 2);
      return;
    }
    const sceneBounds = scene.getBoundingClientRect();
    const closedBookWidth = mobile.matches
      ? Math.min(viewport.width * 1.4, viewport.height * .72) : book.offsetWidth;
    const pageWidth = closedBookWidth / 2;
    const closedRight = sceneBounds.left - viewport.left + sceneBounds.width / 2 + pageWidth / 2;
    const closedTop = sceneBounds.top - viewport.top + sceneBounds.height / 2 - closedBookWidth * 4 / 9;
    const leftEdge = Math.max(8, closedRight - pageWidth + 8);
    const top = Math.max(54, closedTop - 38);
    bookmarkRail.style.left = `${leftEdge}px`;
    bookmarkRail.style.top = `${top}px`;
    bookmarkRail.style.width = `${Math.max(50, Math.min(pageWidth - 16, viewport.width - leftEdge - 12))}px`;
    bookmarkRail.classList.toggle('is-overflowing', bookmarkList.scrollWidth > bookmarkList.clientWidth + 2);
    if (mobile.matches) {
      bookmarkHint.style.left = '';
      bookmarkHint.style.top = '';
    } else {
      const hintLeft = Math.min(viewport.width - bookmarkHint.offsetWidth - 24,
        closedRight + 56);
      bookmarkHint.style.left = `${hintLeft}px`;
      bookmarkHint.style.top = `${intro.getBoundingClientRect().top - viewport.top}px`;
    }
  }

  function showBookmarks(progress) {
    if (isPhone()) {
      bookmarkRail.hidden = !bookmarkSignature || !!bookmarkedStory || progress >= .5;
      bookmarkRail.style.opacity = String(Math.max(0, 1 - progress * 2));
      bookmarkRail.style.pointerEvents = progress >= .45 ? 'none' : '';
      bookmarkHint.hidden = true;
      return;
    }
    const opening = Math.min(1, Math.max(0, progress));
    bookmarkRail.hidden = !bookmarkSignature || !!bookmarkedStory || opening >= .15;
    bookmarkRail.style.opacity = String(Math.max(0, 1 - opening * 7));
    bookmarkRail.style.pointerEvents = opening > .03 ? 'none' : '';
    bookmarkHint.hidden = !bookmarkSignature || !!bookmarkedStory || opening >= .2;
    bookmarkHint.style.opacity = String(Math.max(0, 1 - opening * 5));
  }

  function updateBookmarkSelection() {
    for (const button of bookmarkList.querySelectorAll('button')) {
      button.setAttribute('aria-pressed', String(button.dataset.storyUrl === bookmarkedStory?.url));
    }
    bookmarkReturn.hidden = !bookmarkedStory;
    mobileBookmarkReturn.hidden = !bookmarkedStory;
  }

  function closeBookmark() {
    if (!bookmarkedStory) return;
    clearTimeout(bookmarkTimer);
    bookmarkedStory = null;
    bookmarkOpenFromCover = false;
    book.classList.remove('bookmark-preview');
    updateBookmarkSelection();
    schedule();
  }

  function openBookmark(story) {
    if (bookmarkedStory?.url === story.url) {
      closeBookmark();
      return;
    }
    clearTimeout(bookmarkTimer);
    if (isPhone()) {
      bookmarkedStory = story;
      activeIndex = -1;
      overlayOpen = false;
      updateBookmarkSelection();
      showBookmarks(progressNow());
      schedule();
      return;
    }
    bookmarkOpenFromCover = !bookmarkedStory && progressNow() < 1;
    bookmarkedStory = story;
    book.classList.add('bookmark-preview');
    updateBookmarkSelection();
    showBookmarks(progressNow());
    schedule();
    if (bookmarkOpenFromCover) {
      bookmarkTimer = setTimeout(() => {
        bookmarkOpenFromCover = false;
        book.classList.remove('bookmark-preview');
        schedule();
      }, reducedMotion.matches ? 0 : 570);
    } else {
      book.classList.remove('bookmark-preview');
    }
  }

  function refreshBookmarks() {
    const now = Date.now();
    const recent = feed.filter((story) => {
      const created = Date.parse(story.createdAt);
      const age = now - created;
      return Number.isFinite(created) && age >= 0 && age < 48 * 60 * 60 * 1000;
    }).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
    const signature = recent.map((story) => story.url).join('|');
    if (signature === bookmarkSignature) return;
    bookmarkSignature = signature;
    const buttons = recent.map((story, index) => {
      const button = document.createElement('button');
      button.className = 'scroll-bookmark';
      button.type = 'button';
      button.dataset.storyUrl = story.url;
      button.style.setProperty('--bookmark-color',
        `hsl(${(18 + index * 137.508) % 360} 60% ${index % 2 ? 25 : 28}%)`);
      button.textContent = String(index + 1);
      button.title = `${story.title} — created ${new Date(story.createdAt).toLocaleString()}`;
      button.setAttribute('aria-label', `Open new story: ${story.title}`);
      button.addEventListener('click', () => openBookmark(story));
      return button;
    });
    bookmarkList.replaceChildren(...buttons);
    updateBookmarkSelection();
    showBookmarks(progressNow());
    positionBookmarks();
  }

  function indexAt(value) {
    return ((value % stories.length) + stories.length) % stories.length;
  }

  function setCover(element, story) {
    if (element.dataset.cover === story.cover) return;
    const image = document.createElement('img');
    image.src = story.cover;
    image.alt = '';
    image.decoding = 'async';
    element.replaceChildren(image);
    element.dataset.cover = story.cover;
  }

  function setPrompt(story, animate = false) {
    if (left.dataset.prompt === story.url) return;
    const panel = document.createElement('div');
    panel.className = 'scroll-prompt';
    if (animate) panel.classList.add('scroll-prompt-entering');
    const label = document.createElement('span');
    label.className = 'scroll-prompt-label';
    label.textContent = '[WP]';
    const copy = document.createElement('p');
    copy.textContent = story.prompt;
    panel.append(label, copy);
    left.replaceChildren(panel);
    left.dataset.prompt = story.url;
  }

  function preload(index) {
    for (const offset of [-1, 1, 2]) {
      const image = new Image();
      image.src = stories[indexAt(index + offset)].cover;
    }
  }

  function displayStory(story, label, animatePrompt = false) {
    setPrompt(story, animatePrompt);
    read.href = story.url;
    read.hidden = false;
    details.hidden = false;
    scene.setAttribute('aria-label', label);
  }

  function setActive(index, animatePrompt = false) {
    if (index === activeIndex) return;
    const previousIndex = activeIndex;
    activeIndex = index;
    const story = stories[index];
    displayStory(story, `Story cover book. ${story.title}, ${index + 1} of ${stories.length}.`,
      animatePrompt && previousIndex >= 0);
    preload(index);
  }

  function renderBookmark() {
    const story = bookmarkedStory;
    activeIndex = -1;
    book.classList.add('scroll-book-open');
    book.style.setProperty('--open', '1');
    book.style.setProperty('--end', '0');
    book.style.top = '50%';
    book.style.transform = 'translate(-50%, -50%)';
    intro.style.opacity = '0';
    end.hidden = true;
    end.inert = true;
    left.classList.remove('scroll-awaiting-open');
    left.style.opacity = '1';
    right.style.opacity = '1';
    opening.hidden = !bookmarkOpenFromCover;
    if (bookmarkOpenFromCover) opening.style.transform = 'rotateY(-180deg)';
    opening.style.setProperty('--cover-light', '.08');
    opening.style.setProperty('--turn-shadow', '0');
    turn.hidden = true;
    ending.hidden = true;
    setCover(right, story);
    displayStory(story, `New story. ${story.title}.`, true);
  }

  function renderPhone(progress) {
    const step = Math.round(progress);
    const atIntro = step === 0 && !bookmarkedStory;
    const atEnd = step >= stories.length + 1 && !bookmarkedStory;
    const index = Math.min(stories.length - 1, Math.max(0, step - 1));
    const story = bookmarkedStory || stories[index];
    const storyKey = atIntro ? 'intro' : atEnd ? 'end' : story.url;
    if (storyKey !== mobileStory.dataset.storyKey) overlayOpen = false;
    mobileStory.dataset.storyKey = storyKey;
    lastPhoneStep = step;
    mobileStory.hidden = atEnd;
    mobileStory.classList.toggle('is-intro', atIntro);
    mobileBookmarkReturn.hidden = !bookmarkedStory;
    mobileToggle.hidden = atIntro || atEnd;
    mobileOverlay.hidden = atIntro || atEnd || !portraitPhone.matches || !overlayOpen;
    mobileToggle.setAttribute('aria-expanded', String(!atIntro && !atEnd && portraitPhone.matches && overlayOpen));
    intro.style.opacity = '0';
    end.hidden = !atEnd;
    end.inert = !atEnd;
    end.style.opacity = atEnd ? '1' : '0';
    end.style.top = '';
    details.hidden = true;
    if (atEnd) {
      activeIndex = -1;
    } else if (atIntro) {
      mobileStory.setAttribute('aria-label', 'Book cover. Swipe to browse stories or select a bookmark.');
      if (mobileCover.dataset.cover !== mobileFrontCover) {
        mobileCover.src = mobileFrontCover;
        mobileBackdrop.src = mobileFrontCover;
        mobileCover.dataset.cover = mobileFrontCover;
      }
      mobileCover.alt = 'Story Computing Machine book cover';
      activeIndex = -1;
    } else {
      mobileStory.setAttribute('aria-label', bookmarkedStory
        ? `New story. ${story.title}.`
        : `${story.title}, ${index + 1} of ${stories.length}.`);
      if (mobileCover.dataset.cover !== story.cover) {
        mobileCover.src = story.cover;
        mobileBackdrop.src = story.cover;
        mobileCover.dataset.cover = story.cover;
      }
      mobileCover.alt = `Cover art for ${story.title}`;
      mobileSideCopy.textContent = story.prompt;
      mobileOverlayCopy.textContent = story.prompt;
      mobileSideRead.href = story.url;
      mobileOverlayRead.href = story.url;
      activeIndex = bookmarkedStory ? -1 : index;
      if (!bookmarkedStory) preload(index);
    }
  }

  function render(progress) {
    if (!stories.length) return;
    if (isPhone()) {
      if (bookmarkRail.parentElement !== mobileStory) {
        mobileStory.insertBefore(bookmarkRail, mobileCover);
      }
      renderPhone(progress);
      return;
    }
    if (bookmarkRail.parentElement !== bookmarkHost) {
      bookmarkHost.insertBefore(bookmarkRail, bookmarkHint);
    }
    mobileStory.hidden = true;
    if (bookmarkedStory) {
      renderBookmark();
      return;
    }
    left.classList.toggle('scroll-awaiting-open', progress < 1);
    const closing = progress > stories.length ? Math.min(1, progress - stories.length) : 0;
    const open = closing ? 1 - closing : Math.min(1, progress);
    book.classList.toggle('scroll-book-open', progress >= 1 && !closing);
    book.style.setProperty('--open', String(open));
    book.style.setProperty('--end', String(closing));
    const mobileEndCenter = Math.max(scene.clientHeight * .28, 70 + book.offsetHeight / 2);
    book.style.top = mobile.matches
      ? `${50 + (mobileEndCenter / scene.clientHeight * 100 - 50) * closing}%`
      : '50%';
    end.style.top = mobile.matches ? '4.25rem' : '50%';
    const endMargin = mobile.matches ? 16 : Math.max(scene.clientWidth * .08,
      scene.clientWidth / 2 - book.offsetWidth / 2 - 80);
    const endShift = endMargin - (scene.clientWidth / 2 - book.offsetWidth / 2);
    book.style.transform = `translate(-50%, -50%) translateX(${closing ? 0 : -25 * (1 - open)}%) translateX(${endShift * closing}px)`;
    intro.style.opacity = closing ? '0' : String(Math.max(0, 1 - open * 5));
    end.hidden = closing <= .72;
    end.inert = closing < .95;
    end.style.opacity = String(Math.min(1, Math.max(0, (closing - .72) / .28)));
    if (progress < 1) {
      activeIndex = -1;
      scene.setAttribute('aria-label', 'Story cover book. Scroll to open.');
      opening.hidden = false;
      turn.hidden = true;
      ending.hidden = true;
      right.style.opacity = String(Math.min(1, open * 8));
      opening.style.transform = `rotateY(${-180 * open}deg)`;
      opening.style.setProperty('--cover-light', String(.08 + .55 * Math.sin(Math.PI * open)));
      opening.style.setProperty('--turn-shadow', String(Math.sin(Math.PI * open)));
      openingBack.style.opacity = '1';
      left.style.opacity = '0';
      setPrompt(stories[0]);
      setCover(right, stories[0]);
      details.hidden = true;
      return;
    }

    if (progress >= stories.length) {
      const last = stories.length - 1;
      if (closing >= .95) scene.setAttribute('aria-label', 'Closed story cover book. About the project.');
      opening.hidden = true;
      turn.hidden = true;
      ending.hidden = false;
      setCover(endingFront, stories[last]);
      setPrompt(stories[last]);
      ending.style.transform = `rotateY(${-180 * closing}deg)`;
      ending.style.setProperty('--cover-light', String(.08 + .55 * Math.sin(Math.PI * closing)));
      ending.style.setProperty('--turn-shadow', String(Math.sin(Math.PI * closing)));
      left.style.opacity = String(Math.min(1, (1 - closing) * 8));
      right.style.opacity = '0';
      if (closing < .55) setActive(last);
      else {
        activeIndex = -1;
        details.hidden = true;
      }
      return;
    }

    opening.hidden = true;
    ending.hidden = true;
    right.style.opacity = '1';
    left.style.opacity = '1';
    const page = progress - 1;
    const whole = Math.floor(page);
    const fraction = page - whole;
    const current = indexAt(whole);
    const next = indexAt(whole + 1);
    setCover(right, stories[next]);
    setCover(front, stories[current]);
    turn.hidden = fraction >= .5;
    turn.style.opacity = String(Math.min(1, Math.max(0, (.5 - fraction) * 8)));
    turn.style.transform = `rotateY(${-180 * fraction}deg)`;
    setActive(fraction >= .5 ? next : current, true);
  }

  function progressNow() {
    const steps = stories.length + 2;
    return Math.max(0, Math.min(steps - 1,
      track.scrollLeft / (home.offsetWidth / steps)));
  }

  function schedule() {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      const progress = progressNow();
      const displayedProgress = reducedMotion.matches ? Math.round(progress) : progress;
      render(displayedProgress);
      showBookmarks(displayedProgress);
      positionBookmarks();
    });
  }

  track.addEventListener('wheel', (event) => {
    if (!stories.length || event.ctrlKey) return;
    if (isPhone() && event.target.closest('.mobile-prompt-side, .mobile-prompt-overlay')) return;
    if (bookmarkedStory) closeBookmark();
    const delta = event.deltaY + event.deltaX;
    if (track.scrollLeft >= track.scrollWidth - track.clientWidth - 1) {
      event.preventDefault();
      if (delta > 0 || end.scrollTop > 0) end.scrollTop += delta;
      else track.scrollLeft += delta;
      return;
    }
    event.preventDefault();
    track.scrollLeft += delta;
  }, { passive: false });
  track.addEventListener('scroll', schedule, { passive: true });
  bookmarkList.addEventListener('wheel', (event) => {
    if (event.ctrlKey) return;
    if (bookmarkList.scrollWidth > bookmarkList.clientWidth + 1) {
      event.stopPropagation();
    }
  }, { passive: true });
  bookmarkReturn.addEventListener('click', closeBookmark);
  mobileBookmarkReturn.addEventListener('click', closeBookmark);
  mobileToggle.addEventListener('click', () => {
    overlayOpen = !overlayOpen;
    schedule();
  });
  mobileClose.addEventListener('click', () => {
    overlayOpen = false;
    schedule();
    mobileToggle.focus();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && overlayOpen) {
      overlayOpen = false;
      schedule();
      mobileToggle.focus();
    }
    if (event.key === 'Escape') closeBookmark();
  });
  window.addEventListener('resize', () => {
    const mode = portraitPhone.matches ? 'portrait' : landscapePhone.matches ? 'landscape' : 'desktop';
    if (mode !== lastPhoneMode && stories.length) {
      if (mode !== 'desktop' && bookmarkedStory) closeBookmark();
      const step = lastPhoneMode === 'desktop'
        ? end.hidden ? Math.max(0, activeIndex + 1) : stories.length + 1
        : lastPhoneStep;
      track.scrollLeft = step * track.clientWidth;
      activeIndex = -1;
      overlayOpen = false;
    }
    lastPhoneMode = mode;
    schedule();
  });

  fetch(home.dataset.coverFeed)
    .then((response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json();
    })
    .then((items) => {
      if (!Array.isArray(items) || items.length < 2 ||
          !items.every((item) => item.title && item.cover && item.url && item.rating && item.prompt)) {
        throw new Error('Invalid cover feed');
      }
      const candidates = [...items];
      for (let i = candidates.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
      }
      feed = items;
      stories = candidates.slice(0, 10);
      home.style.setProperty('--mobile-steps', String(stories.length + 2));
      render(progressNow());
      refreshBookmarks();
      setInterval(refreshBookmarks, 60 * 1000);
      schedule();
    })
    .catch(() => {
      scene.setAttribute('aria-label', 'Story cover book. Browse the library for more stories.');
      if (isPhone()) {
        mobileStory.hidden = false;
        mobileStory.classList.remove('is-intro');
        mobileStory.setAttribute('aria-label', 'Story cover book. Browse the library for more stories.');
        mobileOverlay.hidden = false;
        mobileOverlay.setAttribute('aria-label', 'Story library');
        mobileSideCopy.textContent = 'Browse the story library while the featured covers are unavailable.';
        mobileOverlayCopy.textContent = mobileSideCopy.textContent;
      }
    });
})();

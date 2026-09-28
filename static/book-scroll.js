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
  const title = document.getElementById('scroll-title');
  const count = document.getElementById('scroll-count');
  const details = document.getElementById('scroll-details');
  const read = document.getElementById('scroll-read');
  const ambient = document.getElementById('scroll-ambient-image');
  const intro = document.getElementById('scroll-intro');
  const scene = document.getElementById('scroll-scene');
  const end = document.getElementById('about');
  const mobile = matchMedia('(max-width: 600px)');
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  let stories = [];
  let frame = 0;
  let activeIndex = -1;

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

  function setActive(index, animatePrompt = false) {
    if (index === activeIndex) return;
    const previousIndex = activeIndex;
    activeIndex = index;
    const story = stories[index];
    setPrompt(story, animatePrompt && previousIndex >= 0);
    count.textContent = `${String(index + 1).padStart(2, '0')} / ${String(stories.length).padStart(2, '0')}  ·  ${story.rating}`;
    title.textContent = story.title;
    read.href = story.url;
    read.hidden = false;
    details.hidden = false;
    ambient.src = story.cover;
    scene.setAttribute('aria-label', `Story cover book. ${story.title}, ${index + 1} of ${stories.length}.`);
    preload(index);
  }

  function render(progress) {
    if (!stories.length) return;
    left.classList.toggle('scroll-awaiting-open', progress < 1);
    const closing = progress > stories.length ? Math.min(1, progress - stories.length) : 0;
    const open = closing ? 1 - closing : Math.min(1, progress);
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
    intro.style.opacity = closing ? '0' : String(Math.max(0, 1 - open * 3));
    intro.style.transform = `translateY(${-24 * open}px)`;
    end.hidden = closing <= .72;
    end.inert = closing < .95;
    end.style.opacity = String(Math.min(1, Math.max(0, (closing - .72) / .28)));
    if (progress < 1) {
      activeIndex = -1;
      opening.hidden = false;
      turn.hidden = true;
      ending.hidden = true;
      right.style.opacity = '1';
      opening.style.transform = `rotateY(${-180 * open}deg)`;
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
      left.style.opacity = '1';
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
    return Math.max(0, Math.min(stories.length + 1,
      track.scrollLeft / (home.offsetWidth / (stories.length + 2))));
  }

  function schedule() {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      const progress = progressNow();
      render(reducedMotion.matches ? Math.round(progress) : progress);
    });
  }

  track.addEventListener('wheel', (event) => {
    if (!stories.length || event.ctrlKey) return;
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
  window.addEventListener('resize', schedule);

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
      stories = candidates.slice(0, 10);
      schedule();
    })
    .catch(() => {
      scene.setAttribute('aria-label', 'Story cover book. Browse the library for more stories.');
    });
})();

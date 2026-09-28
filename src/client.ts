import { RATING_ORDER, type GuideQuestion, type Match, type Rating, type Turn } from './shared';

const query = new URLSearchParams(location.search);
if (query.has('q') || query.has('rating')) {
  location.replace(`/library/${location.search}`);
}

const guide = document.getElementById('story-guide');
if (guide) {
  const conversation = document.getElementById('guide-conversation')!;
  const ratingStep = document.getElementById('guide-rating-step')!;
  const ratingSlider = document.getElementById('guide-rating') as HTMLInputElement;
  const ratingValue = document.getElementById('guide-rating-value')!;
  const ratingDescription = document.getElementById('guide-rating-description')!;
  const ratingContinue = document.getElementById('guide-rating-continue') as HTMLButtonElement;
  const progress = document.getElementById('guide-progress')!;
  const choices = document.getElementById('guide-choices')!;
  const form = document.getElementById('guide-form') as HTMLFormElement;
  const answer = document.getElementById('guide-answer') as HTMLTextAreaElement;
  const cancelOther = document.getElementById('guide-cancel-other') as HTMLButtonElement;
  const status = document.getElementById('guide-status')!;
  const results = document.getElementById('guide-results')!;
  const early = document.getElementById('guide-results-now') as HTMLButtonElement;
  const restart = document.getElementById('guide-restart') as HTMLButtonElement;
  let rating: Rating | null = null;
  let currentQuestion = '';
  let currentChoices: string[] = [];
  let turns: Turn[] = [];
  let busy = false;
  const ratingDescriptions: Record<Rating, string> = {
    General: 'Suitable for all ages.',
    Teen: 'May not suit readers under 13.',
    Mature: 'May include adult themes or stronger violence.',
    Explicit: 'May include detailed adult content.',
  };

  function updateRating(): void {
    const selected = RATING_ORDER[Number(ratingSlider.value)] || 'General';
    ratingValue.textContent = selected;
    ratingDescription.textContent = ratingDescriptions[selected];
    ratingSlider.setAttribute('aria-valuetext', `Up to ${selected}`);
  }

  function message(text: string, role: 'assistant' | 'reader'): void {
    const bubble = document.createElement('div');
    bubble.className = `guide-message guide-${role}`;
    const paragraph = document.createElement('p');
    paragraph.textContent = text;
    bubble.append(paragraph);
    conversation.append(bubble);
    conversation.scrollTop = conversation.scrollHeight;
  }

  function setBusy(value: boolean, text = ''): void {
    busy = value;
    status.textContent = text;
    answer.disabled = value;
    form.querySelectorAll('button').forEach((button) => { button.disabled = value; });
    choices.querySelectorAll('button').forEach((button) => { button.disabled = value; });
    ratingSlider.disabled = value;
    ratingContinue.disabled = value;
    early.disabled = value;
  }

  function showFailure(error: unknown): void {
    setBusy(false);
    status.textContent = error instanceof Error ? error.message : 'The guide is unavailable.';
    const link = document.createElement('a');
    link.href = '/library/';
    link.textContent = 'Browse the library →';
    status.append(' ', link);
  }

  async function post<T>(path: string, payload: unknown): Promise<T> {
    const response = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await response.json() as T & { error?: string };
    if (!response.ok) throw new Error(data.error || 'The guide is unavailable. Please try again.');
    return data;
  }

  async function nextQuestion(): Promise<void> {
    if (!rating || busy) return;
    setBusy(true, 'The guide is thinking…');
    try {
      const data = await post<GuideQuestion>('/api/guide/question', { rating, turns });
      if (!data.question || !Array.isArray(data.choices) || data.choices.length !== 3) {
        throw new Error('The guide could not prepare the next question.');
      }
      currentQuestion = data.question;
      currentChoices = data.choices;
      message(currentQuestion, 'assistant');
      progress.textContent = `Question ${turns.length + 1} of 4`;
      progress.hidden = false;
      choices.replaceChildren();
      currentChoices.forEach((choice, index) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.dataset.choice = String(index);
        button.textContent = choice;
        choices.append(button);
      });
      const other = document.createElement('button');
      other.type = 'button';
      other.dataset.other = '';
      other.className = 'guide-other';
      other.textContent = 'Other — write my own';
      choices.append(other);
      choices.hidden = false;
      form.hidden = true;
      early.hidden = turns.length < 2;
      setBusy(false);
      choices.scrollIntoView({ block: 'nearest', behavior: 'instant' });
      choices.querySelector('button')?.focus({ preventScroll: true });
    } catch (error) {
      showFailure(error);
    }
  }

  function showMatches(matches: Match[]): void {
    results.replaceChildren();
    const heading = document.createElement('h2');
    heading.textContent = 'Three stories for you';
    results.append(heading);
    for (const match of matches) {
      const card = document.createElement('article');
      card.className = 'guide-match';
      const coverLink = document.createElement('a');
      coverLink.href = match.url;
      const cover = document.createElement('img');
      cover.src = match.cover;
      cover.alt = `Cover for ${match.title}`;
      cover.loading = 'lazy';
      coverLink.append(cover);
      const copy = document.createElement('div');
      const meta = document.createElement('p');
      meta.className = 'eyebrow';
      meta.textContent = match.rating;
      const title = document.createElement('h3');
      const titleLink = document.createElement('a');
      titleLink.href = match.url;
      titleLink.textContent = match.title;
      title.append(titleLink);
      const reason = document.createElement('p');
      reason.textContent = match.reason;
      const promptLabel = document.createElement('strong');
      promptLabel.textContent = 'The writing prompt';
      const prompt = document.createElement('blockquote');
      prompt.textContent = match.prompt;
      const read = document.createElement('a');
      read.href = match.url;
      read.className = 'guide-read';
      read.textContent = 'Read the story →';
      copy.append(meta, title, reason, promptLabel, prompt, read);
      card.append(coverLink, copy);
      results.append(card);
    }
    conversation.hidden = true;
    ratingStep.hidden = true;
    choices.hidden = true;
    progress.hidden = true;
    form.hidden = true;
    early.hidden = true;
    results.hidden = false;
    restart.hidden = false;
    results.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function getMatches(): Promise<void> {
    if (!rating || busy || turns.length < 2) return;
    setBusy(true, 'Finding your stories…');
    try {
      const data = await post<{ stories: Match[] }>('/api/guide/matches', { rating, turns });
      showMatches(data.stories);
      setBusy(false);
    } catch (error) {
      showFailure(error);
    }
  }

  function chooseAnswer(value: string): void {
    if (!currentQuestion || busy) return;
    turns.push({ question: currentQuestion, answer: value });
    message(value, 'reader');
    currentQuestion = '';
    currentChoices = [];
    choices.hidden = true;
    progress.hidden = true;
    form.hidden = true;
    early.hidden = true;
    answer.value = '';
    if (turns.length >= 4) void getMatches();
    else void nextQuestion();
  }

  ratingSlider.addEventListener('input', updateRating);
  ratingContinue.addEventListener('click', () => {
    if (busy) return;
    rating = RATING_ORDER[Number(ratingSlider.value)] || 'General';
    message(`Up to ${rating}`, 'reader');
    ratingStep.hidden = true;
    void nextQuestion();
  });

  choices.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button');
    if (!button || busy) return;
    if ('choice' in button.dataset) {
      const value = currentChoices[Number(button.dataset.choice)];
      if (value) chooseAnswer(value);
    } else if ('other' in button.dataset) {
      choices.hidden = true;
      form.hidden = false;
      form.scrollIntoView({ block: 'nearest', behavior: 'instant' });
      answer.focus({ preventScroll: true });
    }
  });

  cancelOther.addEventListener('click', () => {
    form.hidden = true;
    choices.hidden = false;
    choices.scrollIntoView({ block: 'nearest', behavior: 'instant' });
    choices.querySelector<HTMLButtonElement>('[data-other]')?.focus({ preventScroll: true });
  });

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const value = answer.value.trim();
    if (!value || !currentQuestion || busy) return;
    chooseAnswer(value);
  });

  updateRating();
  early.addEventListener('click', () => { void getMatches(); });
  restart.addEventListener('click', () => { location.reload(); });
}

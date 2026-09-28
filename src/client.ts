import type { Match, Rating, Turn } from './shared';

const query = new URLSearchParams(location.search);
if (query.has('q') || query.has('rating')) {
  location.replace(`/library/${location.search}`);
}

const guide = document.getElementById('story-guide');
if (guide) {
  const conversation = document.getElementById('guide-conversation')!;
  const ratingButtons = document.getElementById('guide-rating')!;
  const form = document.getElementById('guide-form') as HTMLFormElement;
  const answer = document.getElementById('guide-answer') as HTMLTextAreaElement;
  const status = document.getElementById('guide-status')!;
  const results = document.getElementById('guide-results')!;
  const early = document.getElementById('guide-results-now') as HTMLButtonElement;
  const restart = document.getElementById('guide-restart') as HTMLButtonElement;
  let rating: Rating | null = null;
  let currentQuestion = '';
  let turns: Turn[] = [];
  let busy = false;

  function message(text: string, role: 'assistant' | 'reader'): void {
    const bubble = document.createElement('div');
    bubble.className = `guide-message guide-${role}`;
    const paragraph = document.createElement('p');
    paragraph.textContent = text;
    bubble.append(paragraph);
    conversation.append(bubble);
    bubble.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  function setBusy(value: boolean, text = ''): void {
    busy = value;
    status.textContent = text;
    answer.disabled = value;
    form.querySelectorAll('button').forEach((button) => { button.disabled = value; });
    ratingButtons.querySelectorAll('button').forEach((button) => { button.disabled = value; });
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
      const data = await post<{ question: string }>('/api/guide/question', { rating, turns });
      currentQuestion = data.question;
      message(currentQuestion, 'assistant');
      form.hidden = false;
      early.hidden = turns.length < 2;
      answer.focus();
      setBusy(false);
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
    form.hidden = true;
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

  ratingButtons.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-rating]');
    if (!button || busy) return;
    rating = button.dataset.rating as Rating;
    message(button.textContent || rating, 'reader');
    ratingButtons.hidden = true;
    void nextQuestion();
  });

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const value = answer.value.trim();
    if (!value || !currentQuestion || busy) return;
    turns.push({ question: currentQuestion, answer: value });
    message(value, 'reader');
    answer.value = '';
    if (turns.length >= 4) void getMatches();
    else void nextQuestion();
  });

  early.addEventListener('click', () => { void getMatches(); });
  restart.addEventListener('click', () => { location.reload(); });
}

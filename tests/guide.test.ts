import assert from 'node:assert/strict';
import { test } from 'node:test';
import worker, { type Env } from '../src/worker';
import { makeMatches, pickCandidateSlugs } from '../src/recommend';
import { validateTurns, type GuideStory } from '../src/shared';

const catalog: GuideStory[] = [
  { slug: 'quiet', title: 'Quiet', rating: 'PG', canon: false, prompt: 'A quiet garden comes alive.', body: 'A reflective garden story.', cover: 'https://art.example/quiet.jpg', url: '/stories/quiet/' },
  { slug: 'mystery', title: 'Mystery', rating: 'PG', canon: true, prompt: 'A locked room holds a secret.', body: 'A mystery story.', cover: 'https://art.example/mystery.jpg', url: '/stories/mystery/' },
  { slug: 'wonder', title: 'Wonder', rating: 'PG', canon: false, prompt: 'A child discovers a moon.', body: 'A wondrous story.', cover: 'https://art.example/wonder.jpg', url: '/stories/wonder/' },
  { slug: 'older', title: 'Older', rating: 'YA', canon: false, prompt: 'A difficult choice.', body: 'A complex story.', cover: 'https://art.example/older.jpg', url: '/stories/older/' },
  { slug: 'intense', title: 'Intense', rating: 'R+', canon: false, prompt: 'A dark battle.', body: 'A grim story.', cover: 'https://art.example/intense.jpg', url: '/stories/intense/' },
];

test('matches use exact catalog prompts and never exceed the rating', () => {
  const result = makeMatches({ matches: [
    { slug: 'older', reason: 'Invented prompt.' },
    { slug: 'quiet', reason: 'A gentle pace.' },
    { slug: 'mystery', reason: 'A puzzle.' },
    { slug: 'wonder', reason: 'A sense of wonder.' },
  ] }, catalog, 'PG');
  assert.deepEqual(result.map((item) => item.slug), ['quiet', 'mystery', 'wonder']);
  assert.equal(result[0].prompt, catalog[0].prompt);
  assert.equal(result[0].url, catalog[0].url);
});

test('invalid model picks cannot produce invented or generic matches', () => {
  assert.throws(() => makeMatches({ matches: [
    { slug: 'quiet', reason: 'A gentle pace.' },
    { slug: 'fake', reason: 'An invented story.' },
    { slug: 'mystery', reason: '' },
  ] }, catalog, 'PG'));
});

test('shortlist ignores invented and duplicate slugs', () => {
  assert.deepEqual(pickCandidateSlugs({ slugs: ['quiet', 'quiet', 'fake'] }, catalog, 3),
    ['quiet', 'mystery', 'wonder']);
});

test('conversation rejects oversized and excessive answers', () => {
  assert.throws(() => validateTurns(Array(5).fill({ question: 'What?', answer: 'Anything' })));
  assert.throws(() => validateTurns([{ question: 'What?', answer: 'x'.repeat(1001) }]));
});

test('Worker filters before prompting and joins model slugs to published stories', async () => {
  const oldFetch = globalThis.fetch;
  const requests: any[] = [];
  let call = 0;
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    requests.push(body);
    const content = call++ === 0
      ? { slugs: ['mystery', 'quiet', 'wonder'] }
      : { matches: [
        { slug: 'mystery', reason: 'A focused mystery.' },
        { slug: 'quiet', reason: 'A reflective mood.' },
        { slug: 'wonder', reason: 'A sense of wonder.' },
      ] };
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }] }),
      { headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
  const env: Env = {
    ASSETS: { fetch: async () => new Response(JSON.stringify(catalog)) },
    GUIDE_LIMIT: { limit: async () => ({ success: true }) },
    OPENROUTER_API_KEY: 'test-key',
  };
  try {
    const response = await worker.fetch(new Request('https://stories.example/api/guide/matches', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rating: 'PG', turns: [
        { question: 'Mood?', answer: 'I want a quiet mystery.' },
        { question: 'Pace?', answer: 'Something reflective.' },
      ] }),
    }), env);
    assert.equal(response.status, 200);
    const result = await response.json() as { stories: { slug: string; prompt: string }[] };
    assert.deepEqual(result.stories.map((item) => item.slug), ['mystery', 'quiet', 'wonder']);
    assert.equal(result.stories[0].prompt, 'A locked room holds a secret.');
    assert.equal(requests.length, 2);
    assert.ok(!JSON.stringify(requests[0]).includes('A dark battle.'));
    assert.ok(!JSON.stringify(requests[0]).includes('A difficult choice.'));
  } finally {
    globalThis.fetch = oldFetch;
  }
});

test('Worker rate limit blocks AI calls', async () => {
  const response = await worker.fetch(new Request('https://stories.example/api/guide/question', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
  }), {
    ASSETS: { fetch: async () => new Response('') },
    GUIDE_LIMIT: { limit: async () => ({ success: false }) },
    OPENROUTER_API_KEY: 'test-key',
  });
  assert.equal(response.status, 429);
});

test('model failure returns a library-safe error instead of unchecked matches', async () => {
  const oldFetch = globalThis.fetch;
  globalThis.fetch = (async () => { throw new Error('Upstream failed'); }) as typeof fetch;
  try {
    const response = await worker.fetch(new Request('https://stories.example/api/guide/matches', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rating: 'PG', turns: [
        { question: 'Mood?', answer: 'Quiet' }, { question: 'Pace?', answer: 'Slow' },
      ] }),
    }), {
      ASSETS: { fetch: async () => new Response(JSON.stringify(catalog)) },
      GUIDE_LIMIT: { limit: async () => ({ success: true }) },
      OPENROUTER_API_KEY: 'test-key',
    });
    assert.equal(response.status, 503);
    assert.match(await response.text(), /browse the library/i);
  } finally {
    globalThis.fetch = oldFetch;
  }
});

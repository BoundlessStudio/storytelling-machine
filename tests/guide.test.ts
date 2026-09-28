import assert from 'node:assert/strict';
import { test } from 'node:test';
import worker, { type Env } from '../src/worker';
import { askQuestion, chatJson } from '../src/openrouter';
import { makeMatches, pickCandidateSlugs } from '../src/recommend';
import { allowedRating, validateRating, validateTurns, type GuideStory } from '../src/shared';

const catalog: GuideStory[] = [
  { slug: 'quiet', title: 'Quiet', rating: 'General', canon: false, prompt: 'A quiet garden comes alive.', body: 'A reflective garden story.', cover: 'https://art.example/quiet.jpg', url: '/stories/quiet/' },
  { slug: 'mystery', title: 'Mystery', rating: 'General', canon: true, prompt: 'A locked room holds a secret.', body: 'A mystery story.', cover: 'https://art.example/mystery.jpg', url: '/stories/mystery/' },
  { slug: 'wonder', title: 'Wonder', rating: 'General', canon: false, prompt: 'A child discovers a moon.', body: 'A wondrous story.', cover: 'https://art.example/wonder.jpg', url: '/stories/wonder/' },
  { slug: 'older', title: 'Older', rating: 'Teen', canon: false, prompt: 'A difficult choice.', body: 'A complex story.', cover: 'https://art.example/older.jpg', url: '/stories/older/' },
  { slug: 'mature', title: 'Mature', rating: 'Mature', canon: false, prompt: 'A hard choice.', body: 'An intense story.', cover: 'https://art.example/mature.jpg', url: '/stories/mature/' },
  { slug: 'intense', title: 'Intense', rating: 'Explicit', canon: false, prompt: 'A dark battle.', body: 'A grim story.', cover: 'https://art.example/intense.jpg', url: '/stories/intense/' },
];

test('rating comfort follows the source collection scale', () => {
  assert.deepEqual(['General', 'Teen', 'Mature', 'Explicit'].map(validateRating),
    ['General', 'Teen', 'Mature', 'Explicit']);
  assert.throws(() => validateRating('PG'));
  assert.equal(allowedRating('General', 'Teen'), true);
  assert.equal(allowedRating('Mature', 'Teen'), false);
  assert.equal(allowedRating('Explicit', 'Mature'), false);
  assert.equal(allowedRating('Mature', 'Explicit'), true);
});

test('matches use exact catalog prompts and never exceed the rating', () => {
  const result = makeMatches({ matches: [
    { slug: 'older', reason: 'Invented prompt.' },
    { slug: 'quiet', reason: 'A gentle pace.' },
    { slug: 'mystery', reason: 'A puzzle.' },
    { slug: 'wonder', reason: 'A sense of wonder.' },
  ] }, catalog, 'General');
  assert.deepEqual(result.map((item) => item.slug), ['quiet', 'mystery', 'wonder']);
  assert.equal(result[0].prompt, catalog[0].prompt);
  assert.equal(result[0].url, catalog[0].url);
});

test('invalid model picks cannot produce invented or generic matches', () => {
  assert.throws(() => makeMatches({ matches: [
    { slug: 'quiet', reason: 'A gentle pace.' },
    { slug: 'fake', reason: 'An invented story.' },
    { slug: 'mystery', reason: '' },
  ] }, catalog, 'General'));
});

test('shortlist ignores invented and duplicate slugs', () => {
  assert.deepEqual(pickCandidateSlugs({ slugs: ['quiet', 'quiet', 'fake'] }, catalog, 3),
    ['quiet', 'mystery', 'wonder']);
});

test('conversation rejects oversized and excessive answers', () => {
  assert.throws(() => validateTurns(Array(5).fill({ question: 'What?', answer: 'Anything' })));
  assert.throws(() => validateTurns([{ question: 'What?', answer: 'x'.repeat(1001) }]));
});

test('AI question supplies three choices and uses rating as starting context', async () => {
  const oldFetch = globalThis.fetch;
  let request: any;
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    request = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({
      question: 'What kind of mood sounds good today?',
      choices: ['A quiet mystery', 'A hopeful adventure', 'Something tense and strange'],
    }) } }] }), { headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
  try {
    const result = await askQuestion({ key: 'test-key', chatModel: 'test-model' }, 'Mature', []);
    assert.equal(result.choices.length, 3);
    assert.equal(result.choices[0], 'A quiet mystery');
    assert.match(request.messages[1].content, /"highestComfortableRating":"Mature"/);
    assert.match(request.messages[0].content, /Other free-text answer/);
  } finally {
    globalThis.fetch = oldFetch;
  }
});

test('invalid or duplicate AI choices are rejected', async () => {
  const oldFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({
    question: 'What kind of mood sounds good today?',
    choices: ['A quiet mystery', 'A quiet mystery', 'Other'],
  }) } }] }), { headers: { 'Content-Type': 'application/json' } })) as typeof fetch;
  try {
    await assert.rejects(askQuestion({ key: 'test-key', chatModel: 'test-model' }, 'General', []));
  } finally {
    globalThis.fetch = oldFetch;
  }
});

test('question endpoint returns clickable choices at the top level', async () => {
  const oldFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({
    question: 'Which pace sounds right tonight?',
    choices: ['Quiet and reflective', 'A steady build', 'Fast and urgent'],
  }) } }] }), { headers: { 'Content-Type': 'application/json' } })) as typeof fetch;
  try {
    const response = await worker.fetch(new Request('https://stories.example/api/guide/question', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rating: 'Teen', turns: [] }),
    }), {
      ASSETS: { fetch: async () => new Response('') },
      GUIDE_LIMIT: { limit: async () => ({ success: true }) },
      OPENROUTER_API_KEY: 'test-key',
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      question: 'Which pace sounds right tonight?',
      choices: ['Quiet and reflective', 'A steady build', 'Fast and urgent'],
    });
  } finally {
    globalThis.fetch = oldFetch;
  }
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
      body: JSON.stringify({ rating: 'General', turns: [
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
      body: JSON.stringify({ rating: 'General', turns: [
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

test('malformed model JSON is retried once with a larger token budget', async () => {
  const oldFetch = globalThis.fetch;
  const budgets: number[] = [];
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    budgets.push(JSON.parse(String(init?.body)).max_completion_tokens);
    const content = budgets.length === 1 ? '{"question":' : '{"question":"What kind of story appeals to you?"}';
    return new Response(JSON.stringify({ choices: [{ message: { content } }] }),
      { headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
  try {
    const result = await chatJson({ key: 'test-key', chatModel: 'test-model' }, 'Ask', '{}',
      'test_question', { type: 'object' }, 500);
    assert.equal(result.question, 'What kind of story appeals to you?');
    assert.deepEqual(budgets, [500, 1000]);
  } finally {
    globalThis.fetch = oldFetch;
  }
});

test('repeated malformed model JSON is treated as service failure', async () => {
  const oldFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({
    choices: [{ message: { content: '{"slugs":' } }],
  }), { headers: { 'Content-Type': 'application/json' } })) as typeof fetch;
  try {
    const response = await worker.fetch(new Request('https://stories.example/api/guide/matches', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rating: 'General', turns: [
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

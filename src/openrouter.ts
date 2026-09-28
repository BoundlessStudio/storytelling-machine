import type { Turn } from './shared';

export type OpenRouterConfig = { key: string; chatModel: string };

async function openRouterJson(url: string, key: string, body: unknown): Promise<any> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json',
      'HTTP-Referer': 'https://stories.rgbknights.com', 'X-Title': 'Story Computing Machine' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(90_000),
  });
  if (!response.ok) throw new Error(`OpenRouter returned ${response.status}`);
  try {
    return await response.json();
  } catch {
    throw new Error('Invalid OpenRouter response');
  }
}

export async function chatJson(
  config: OpenRouterConfig, system: string, user: string,
  name: string, schema: Record<string, unknown>, maxTokens = 800,
): Promise<any> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const data = await openRouterJson('https://openrouter.ai/api/v1/chat/completions', config.key, {
      model: config.chatModel,
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      response_format: { type: 'json_schema', json_schema: { name, strict: true, schema } },
      provider: { require_parameters: true },
      max_completion_tokens: maxTokens * (attempt + 1),
    });
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== 'string') continue;
    try {
      return JSON.parse(content);
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
    }
  }
  throw new Error(`Invalid model JSON for ${name}`);
}

export async function askQuestion(config: OpenRouterConfig, rating: string, turns: Turn[]): Promise<string> {
  const schema = { type: 'object', properties: { question: { type: 'string' } },
    required: ['question'], additionalProperties: false };
  const data = await chatJson(config,
    'You are a warm, concise librarian helping someone find fiction. Ask exactly one brief, natural follow-up question at a time. Learn the reader\'s preferred mood, pace, premise, and themes across four questions. Their audience rating is already known. Do not mention any story title or reveal a writing prompt. Do not repeat an earlier question. Return JSON only.',
    JSON.stringify({ rating, completedQuestions: turns, nextQuestionNumber: turns.length + 1, maximumQuestions: 4 }),
    'story_guide_question', schema, 500);
  const question = data?.question;
  if (typeof question !== 'string' || question.trim().length < 8 || question.length > 300) {
    throw new Error('Invalid guide question');
  }
  return question.trim();
}

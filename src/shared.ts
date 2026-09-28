export type Rating = 'General' | 'Teen' | 'Mature' | 'Explicit';
export type Turn = { question: string; answer: string };

export type GuideStory = {
  slug: string;
  title: string;
  rating: Rating;
  canon: boolean;
  prompt: string;
  body: string;
  cover: string;
  url: string;
};

export type Match = Omit<GuideStory, 'body' | 'canon'> & { reason: string };

export const RATING_ORDER: Rating[] = ['General', 'Teen', 'Mature', 'Explicit'];

export function allowedRating(story: Rating, comfort: Rating): boolean {
  return RATING_ORDER.indexOf(story) <= RATING_ORDER.indexOf(comfort);
}

export function validateTurns(value: unknown): Turn[] {
  if (!Array.isArray(value) || value.length > 4) throw new Error('Invalid conversation');
  return value.map((turn) => {
    if (!turn || typeof turn !== 'object') throw new Error('Invalid conversation');
    const item = turn as Record<string, unknown>;
    if (typeof item.question !== 'string' || item.question.length > 300 ||
        typeof item.answer !== 'string' || item.answer.trim().length < 2 || item.answer.length > 1000) {
      throw new Error('Invalid answer');
    }
    return { question: item.question, answer: item.answer.trim() };
  });
}

export function validateRating(value: unknown): Rating {
  if (value !== 'General' && value !== 'Teen' && value !== 'Mature' && value !== 'Explicit') throw new Error('Choose an audience rating');
  return value;
}

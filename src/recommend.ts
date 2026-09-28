import { allowedRating, type GuideStory, type Match, type Rating } from './shared';

export function pickCandidateSlugs(value: unknown, allowed: GuideStory[], count: number): string[] {
  const allowedSlugs = new Set(allowed.map((story) => story.slug));
  const list = value && typeof value === 'object' ? (value as { slugs?: unknown }).slugs : null;
  if (!Array.isArray(list)) return allowed.slice(0, count).map((story) => story.slug);
  const unique = [...new Set(list.filter((slug): slug is string => typeof slug === 'string' && allowedSlugs.has(slug)))];
  for (const story of allowed) {
    if (unique.length >= count) break;
    if (!unique.includes(story.slug)) unique.push(story.slug);
  }
  return unique.slice(0, count);
}

export function makeMatches(
  value: unknown, candidates: GuideStory[], rating: Rating,
): Match[] {
  const candidateMap = new Map(candidates.map((story) => [story.slug, story]));
  const data = value && typeof value === 'object' ? (value as { matches?: unknown }).matches : null;
  const selected: { story: GuideStory; reason: string }[] = [];
  if (Array.isArray(data)) {
    for (const item of data) {
      if (!item || typeof item !== 'object') continue;
      const result = item as { slug?: unknown; reason?: unknown };
      const story = typeof result.slug === 'string' ? candidateMap.get(result.slug) : undefined;
      if (!story || !allowedRating(story.rating, rating) || selected.some((s) => s.story.slug === story.slug)) continue;
      const reason = typeof result.reason === 'string' && result.reason.length <= 240
        ? result.reason.trim() : '';
      if (reason.length < 8) continue;
      selected.push({ story, reason });
      if (selected.length === 3) break;
    }
  }
  if (selected.length !== 3) throw new Error('Invalid story matches');
  return selected.slice(0, 3).map(({ story, reason }) => ({
    slug: story.slug, title: story.title, rating: story.rating, prompt: story.prompt,
    cover: story.cover, url: story.url, reason,
  }));
}

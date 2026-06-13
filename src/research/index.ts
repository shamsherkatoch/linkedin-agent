import { z } from 'zod';
import { config } from '../config.ts';
import { loadHistory } from '../history.ts';
import type { NewsItem } from '../types.ts';

const MAX_CANDIDATES = 8;
const MIN_CONTENT_CHARS = 500;
const MAX_LINK_RATIO = 0.5;

const STOPWORDS = new Set([
  'with', 'and', 'or', 'the', 'a', 'an', 'in', 'on', 'for', 'of', 'to',
  'is', 'are', 'be', 'by', 'as', 'at', 'from', 'via', 'about', 'using',
  'will', 'what', 'how', 'does', 'should', 'can', 'why', 'when', 'which',
]);

const TavilyResponse = z.object({
  results: z.array(
    z.object({
      title: z.string(),
      url: z.string().url(),
      content: z.string(),
      published_date: z.string().optional(),
      score: z.number().optional(),
    }),
  ),
});

const TavilyExtractResponse = z.object({
  results: z
    .array(
      z.object({
        url: z.string().url(),
        raw_content: z.string(),
      }),
    )
    .optional()
    .default([]),
  failed_results: z.array(z.unknown()).optional().default([]),
});

async function tavilySearch(topic: string): Promise<z.infer<typeof TavilyResponse>['results']> {
  let res: Response;
  try {
    res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: config.TAVILY_API_KEY,
        query: `Latest news about ${topic}`,
        topic: 'news',
        time_range: 'week',
        max_results: 10,
        search_depth: 'advanced',
      }),
    });
  } catch (err) {
    throw new Error(`Tavily search request failed: ${(err as Error).message}`);
  }
  if (!res.ok) {
    throw new Error(`Tavily search failed: ${res.status} ${await res.text()}`);
  }
  const parsed = TavilyResponse.safeParse(await res.json());
  if (!parsed.success) {
    throw new Error(`Tavily search returned unexpected shape: ${parsed.error.message}`);
  }
  return parsed.data.results;
}

async function tavilyExtract(url: string): Promise<string | null> {
  let res: Response;
  try {
    res = await fetch('https://api.tavily.com/extract', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.TAVILY_API_KEY}`,
      },
      body: JSON.stringify({ urls: [url] }),
    });
  } catch (err) {
    throw new Error(`Tavily extract request failed: ${(err as Error).message}`);
  }
  if (!res.ok) {
    throw new Error(`Tavily extract failed: ${res.status} ${await res.text()}`);
  }
  const parsed = TavilyExtractResponse.safeParse(await res.json());
  if (!parsed.success) {
    throw new Error(`Tavily extract returned unexpected shape: ${parsed.error.message}`);
  }
  const hit = parsed.data.results.find((r) => r.url === url) ?? parsed.data.results[0];
  return hit?.raw_content ?? null;
}

function topicTokens(topic: string): string[] {
  const tokens = topic
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t));
  return Array.from(new Set(tokens));
}

function topicRelevance(
  haystack: string,
  tokens: string[],
): { ok: true } | { ok: false; reason: string } {
  if (tokens.length === 0) return { ok: true };
  const text = haystack.toLowerCase();
  const matched = tokens.filter((t) => text.includes(t));
  const needed = tokens.length <= 2 ? tokens.length : Math.max(2, Math.ceil(tokens.length * 0.4));
  if (matched.length < needed) {
    return {
      ok: false,
      reason:
        `off-topic (matched ${matched.length}/${tokens.length} topic terms, need ${needed}; ` +
        `missing: ${tokens.filter((t) => !matched.includes(t)).join(', ')})`,
    };
  }
  return { ok: true };
}

function mergeSnippetAndExtract(snippet: string, extracted: string | null): string | null {
  const s = snippet?.trim() ?? '';
  const e = extracted?.trim() ?? '';
  if (!s && !e) return null;
  if (!s) return e;
  if (!e) return s;
  return e.toLowerCase().includes(s.toLowerCase()) ? e : `${s}\n\n${e}`;
}

function isHighQuality(text: string): { ok: true } | { ok: false; reason: string } {
  const normalized = text.trim();
  if (normalized.length < MIN_CONTENT_CHARS) {
    return { ok: false, reason: `only ${normalized.length} chars (need ${MIN_CONTENT_CHARS})` };
  }
  const urlChars = (normalized.match(/https?:\/\/\S+/g) ?? []).reduce(
    (sum, m) => sum + m.length,
    0,
  );
  const linkRatio = urlChars / normalized.length;
  if (linkRatio > MAX_LINK_RATIO) {
    return {
      ok: false,
      reason: `link-heavy (${(linkRatio * 100).toFixed(0)}% URL chars)`,
    };
  }
  return { ok: true };
}

export async function fetchLatestNews(topic: string): Promise<NewsItem | null> {
  const results = await tavilySearch(topic);
  const history = await loadHistory();
  const seen = new Set(history.map((h) => h.url));
  const tokens = topicTokens(topic);
  const candidates = [...results]
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .filter((r) => !seen.has(r.url))
    .slice(0, MAX_CANDIDATES);

  if (candidates.length === 0) {
    console.log('No fresh search results (all candidates already in history).');
    return null;
  }

  for (const candidate of candidates) {
    console.log(`      Extracting: ${candidate.url}`);
    const extracted = await tavilyExtract(candidate.url);
    const merged = mergeSnippetAndExtract(candidate.content, extracted);
    if (!merged) {
      console.log(`      Skipped (no content from snippet or extract)`);
      continue;
    }
    const quality = isHighQuality(merged);
    if (!quality.ok) {
      console.log(`      Skipped (${quality.reason})`);
      continue;
    }
    const relevance = topicRelevance(`${candidate.title}\n${merged}`, tokens);
    if (!relevance.ok) {
      console.log(`      Skipped (${relevance.reason})`);
      continue;
    }
    return {
      title: candidate.title,
      url: candidate.url,
      content: merged.trim(),
      ...(candidate.published_date ? { publishedAt: candidate.published_date } : {}),
    };
  }

  console.log(
    `No candidate passed the quality check (tried ${candidates.length}). ` +
      `Required >= ${MIN_CONTENT_CHARS} chars of non-link text in snippet + extract.`,
  );
  return null;
}

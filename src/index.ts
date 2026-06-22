import { config } from './config.ts';
import { fetchLatestNews } from './research/index.ts';
import { draftPost } from './generate/index.ts';
import { promptTopic, requestApproval } from './approval/index.ts';
import { publishPost } from './publish/index.ts';
import { appendHistory } from './history.ts';
import type { NewsItem } from './types.ts';

const dryRun = process.argv.includes('--dry-run');
const MAX_TOPIC_ATTEMPTS = 5;

async function findArticleWithRetries(initialTopic: string): Promise<{ topic: string; item: NewsItem } | null> {
  let topic = initialTopic;
  for (let attempt = 1; attempt <= MAX_TOPIC_ATTEMPTS; attempt++) {
    console.log(`[1/4] Researching (attempt ${attempt}/${MAX_TOPIC_ATTEMPTS}): ${topic}`);
    const item = await fetchLatestNews(topic);
    if (item) return { topic, item };

    if (attempt === MAX_TOPIC_ATTEMPTS) break;

    const retryPrompt =
      `No usable article found for "${topic}".\n\n` +
      `Reply with a different topic to try, or "default" to use:\n${config.TOPIC}\n\n` +
      `(Times out in 2 min → uses default. Attempt ${attempt + 1}/${MAX_TOPIC_ATTEMPTS}.)`;
    topic = await promptTopic(config.TOPIC, retryPrompt);
  }
  return null;
}

async function main(): Promise<void> {
  const initialTopic = await promptTopic(config.TOPIC);
  const found = await findArticleWithRetries(initialTopic);
  if (!found) {
    console.log(`No usable article after ${MAX_TOPIC_ATTEMPTS} topic attempts. Exiting without drafting.`);
    return;
  }
  const { topic, item } = found;
  console.log(`      Selected: ${item.title}`);
  console.log(`      ${item.url}`);

  console.log('[2/4] Drafting post');
  const draft = await draftPost(item);

  console.log('[3/4] Requesting approval');
  const approved = await requestApproval(draft);
  if (!approved) {
    console.log('Draft rejected. Exiting without publishing.');
    return;
  }

  if (dryRun) {
    console.log('[4/4] Dry run — skipping publish.');
    return;
  }

  console.log('[4/4] Publishing to LinkedIn');
  const postUrn = await publishPost(draft);
  console.log(`      Published: ${postUrn}`);

  await appendHistory({
    topic,
    url: draft.sourceUrl,
    date: new Date().toISOString(),
    text: draft.text,
  });
}

main().catch((err: unknown) => {
  console.error('Pipeline failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});

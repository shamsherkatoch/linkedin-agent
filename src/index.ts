import { config } from './config.ts';
import { fetchLatestNews } from './research/index.ts';
import { draftPost } from './generate/index.ts';
import { promptTopic, requestApproval } from './approval/index.ts';
import { publishPost } from './publish/index.ts';
import { appendHistory } from './history.ts';

const dryRun = process.argv.includes('--dry-run');
const MAX_TOPIC_ATTEMPTS = 5;

async function main(): Promise<void> {
  let topic = await promptTopic(config.TOPIC);

  for (let attempt = 1; attempt <= MAX_TOPIC_ATTEMPTS; attempt++) {
    console.log(`[1/4] Researching (attempt ${attempt}/${MAX_TOPIC_ATTEMPTS}): ${topic}`);
    const item = await fetchLatestNews(topic);
    if (!item) {
      if (attempt === MAX_TOPIC_ATTEMPTS) break;
      topic = await promptTopic(
        config.TOPIC,
        `No usable article found for "${topic}".\n\n` +
          `Reply with a different topic to try, or "default" to use:\n${config.TOPIC}\n\n` +
          `(Times out in 2 min → uses default. Attempt ${attempt + 1}/${MAX_TOPIC_ATTEMPTS}.)`,
      );
      continue;
    }
    console.log(`      Selected: ${item.title}`);
    console.log(`      ${item.url}`);

    console.log('[2/4] Drafting post');
    const draft = await draftPost(item);

    console.log('[3/4] Requesting approval');
    const decision = await requestApproval(draft);
    if (decision === 'reject') {
      console.log('Draft rejected. Exiting without publishing.');
      return;
    }
    if (decision === 'new-topic') {
      if (attempt === MAX_TOPIC_ATTEMPTS) break;
      topic = await promptTopic(
        config.TOPIC,
        `Draft not the right topic. Reply with a new topic, or "default" to use:\n${config.TOPIC}\n\n` +
          `(Times out in 2 min → uses default. Attempt ${attempt + 1}/${MAX_TOPIC_ATTEMPTS}.)`,
      );
      continue;
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
    return;
  }

  console.log(`No approved draft after ${MAX_TOPIC_ATTEMPTS} topic attempts. Exiting without publishing.`);
}

main().catch((err: unknown) => {
  console.error('Pipeline failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});

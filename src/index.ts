import { config } from './config.ts';
import { fetchLatestNews } from './research/index.ts';
import { draftPost } from './generate/index.ts';
import { promptTopic, requestApproval } from './approval/index.ts';
import { publishPost } from './publish/index.ts';
import { appendHistory } from './history.ts';

const dryRun = process.argv.includes('--dry-run');

async function main(): Promise<void> {
  const topic = await promptTopic(config.TOPIC);
  console.log(`[1/4] Researching: ${topic}`);
  const item = await fetchLatestNews(topic);
  if (!item) {
    console.log('No usable article. Exiting without drafting.');
    return;
  }
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

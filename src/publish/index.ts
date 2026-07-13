import { config } from '../config.ts';
import type { Draft } from '../types.ts';

const LINKEDIN_VERSION = '202506';

// LinkedIn "Little Text" format silently truncates commentary at unescaped
// special characters. '#' left alone so hashtags stay clickable.
function escapeCommentary(text: string): string {
  return text.replace(/[|{}@\[\]()<>\\*_~]/g, '\\$&');
}

export async function publishPost(draft: Draft): Promise<string> {
  if (!config.LINKEDIN_ACCESS_TOKEN || !config.LINKEDIN_MEMBER_URN) {
    throw new Error('Missing LinkedIn credentials. Run `npm run auth` first.');
  }

  let res: Response;
  try {
    res = await fetch('https://api.linkedin.com/rest/posts', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.LINKEDIN_ACCESS_TOKEN}`,
        'LinkedIn-Version': LINKEDIN_VERSION,
        'X-Restli-Protocol-Version': '2.0.0',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        author: config.LINKEDIN_MEMBER_URN,
        commentary: escapeCommentary(draft.text),
        visibility: 'PUBLIC',
        distribution: {
          feedDistribution: 'MAIN_FEED',
          targetEntities: [],
          thirdPartyDistributionChannels: [],
        },
        lifecycleState: 'PUBLISHED',
        isReshareDisabledByAuthor: false,
      }),
    });
  } catch (err) {
    throw new Error(`LinkedIn publish request failed: ${(err as Error).message}`);
  }

  if (res.status === 401) {
    console.error('LinkedIn returned 401 — your access token is expired or invalid.');
    console.error('Run `npm run auth` to re-authenticate.');
    process.exit(1);
  }

  if (!res.ok) {
    throw new Error(`LinkedIn publish failed: ${res.status} ${await res.text()}`);
  }

  const postUrn = res.headers.get('x-restli-id');
  if (!postUrn) {
    throw new Error('LinkedIn publish succeeded but no post URN returned');
  }
  return postUrn;
}

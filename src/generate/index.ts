import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config.ts';
import type { NewsItem, Draft } from '../types.ts';

const client = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });

function systemPrompt(): string {
  return `You write LinkedIn posts for a practical software engineer.

Rules — follow strictly:
- 150 to ${config.MAX_POST_WORDS} words. First person. Plain, direct voice.
- Exactly one concrete insight or take per post — never a generic news summary.
- Reference the source article and include its URL on its own line at the end.
- Max 3 hashtags. No emojis unless the news is genuinely exciting.
- Never invent facts not present in the article. If unsure, omit.

Output only the post text. No preamble, no meta-commentary about the article, no "Here is the post:" lead-in, no markdown headers, no quotes. The first character of your response must be the first character of the post.`;
}

function stripPreamble(text: string): string {
  let out = text.trim();

  const leadInRegexes = [
    /^[\s\S]*?\bhere(?:'s| is)\s+(?:the|your|a|an)\s+(?:linkedin\s+)?post\s*:\s*/i,
    /^[\s\S]*?\bdraft\s+post\s*:\s*/i,
    /^[\s\S]*?\bpost\s*:\s*\n/i,
  ];
  for (const re of leadInRegexes) {
    const next = out.replace(re, '');
    if (next !== out && next.trim().length > 0) {
      out = next;
      break;
    }
  }

  return out.trim();
}

export async function draftPost(item: NewsItem): Promise<Draft> {
  const userPrompt = `Topic: ${config.TOPIC}

<title>
${item.title}
</title>

<url>
${item.url}
</url>

<article_text>
${item.content}
</article_text>

Write the LinkedIn post now. Base every factual claim on <article_text>. End the post with the <url> on its own line.`;

  let response;
  try {
    response = await client.messages.create({
      model: config.ANTHROPIC_MODEL,
      max_tokens: 1024,
      system: systemPrompt(),
      messages: [{ role: 'user', content: userPrompt }],
    });
  } catch (err) {
    throw new Error(`Anthropic draft failed: ${(err as Error).message}`);
  }

  const textBlock = response.content.find((b) => b.type === 'text');
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('Anthropic response contained no text block');
  }

  return { text: stripPreamble(textBlock.text), sourceUrl: item.url };
}

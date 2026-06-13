# LinkedIn Tech-Topic Posting Agent

## What this project does
A scheduled pipeline that: (1) researches the latest news on a configured
technology topic, (2) drafts a LinkedIn post using the Anthropic API,
(3) sends the draft for human approval, (4) publishes the approved post
via the official LinkedIn REST API.

## Stack
- TypeScript, Node 20+, ESM modules, run with `tsx`
- @anthropic-ai/sdk for generation
- Tavily REST API for topic research (plain fetch, no SDK)
- LinkedIn versioned REST API for publishing (plain fetch)
- zod for validating all external API responses
- No frameworks, no LangChain, no agent orchestration libs — plain functions

## Architecture (pipeline stages, one folder each)
- src/research/   → fetchLatestNews(topic): NewsItem[]  (Tavily search, last 7 days, dedupe against data/post-history.json)
- src/generate/   → draftPost(newsItem, config): Draft  (Anthropic API call, returns { text, sourceUrl })
- src/approval/   → requestApproval(draft): boolean     (Telegram message with approve/reject buttons; falls back to CLI y/n if Telegram not configured)
- src/publish/    → publishPost(draft): postUrn          (POST https://api.linkedin.com/rest/posts)
- src/index.ts    → orchestrates the four stages, logs each step
- scripts/auth.ts → one-time OAuth flow: opens browser, local callback server on :3000, exchanges code for token, fetches member URN from /v2/userinfo, writes both to .env

## LinkedIn API rules (do not deviate)
- Use the versioned REST API: base https://api.linkedin.com/rest
- Required headers on every call: Authorization: Bearer {token},
  LinkedIn-Version: 202506, X-Restli-Protocol-Version: 2.0.0
- Post body shape: { author: memberUrn, commentary, visibility: "PUBLIC",
  distribution: { feedDistribution: "MAIN_FEED" }, lifecycleState: "PUBLISHED" }
- On 401, exit with a clear message telling the user to re-run `npm run auth`
- Never scrape LinkedIn or use unofficial endpoints

## Content rules (bake into the generation system prompt)
- 150–{MAX_POST_WORDS} words, first person, practical engineer voice
- One concrete insight or take per post — never a generic summary
- Must reference the source article and include its URL at the end
- Max 3 hashtags, no emojis unless the news is genuinely exciting
- Never invent facts not present in the researched article

## Conventions
- Every external call wrapped in try/catch with descriptive errors
- All config read once in src/config.ts via zod-validated env parsing
- Append every published post to data/post-history.json (topic, url, date, text)
  and use it to avoid re-posting the same story
- npm scripts: auth, run (single pipeline pass), dry-run (skip publish stage)
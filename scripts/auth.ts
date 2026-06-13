import 'dotenv/config';
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { exec } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';

const PORT = 3000;
const REDIRECT_URI = `http://localhost:${PORT}/callback`;
const SCOPE = 'openid profile w_member_social';

const env = z
  .object({
    LINKEDIN_CLIENT_ID: z.string().min(1, 'set LINKEDIN_CLIENT_ID in .env first'),
    LINKEDIN_CLIENT_SECRET: z.string().min(1, 'set LINKEDIN_CLIENT_SECRET in .env first'),
  })
  .parse(process.env);

const state = randomBytes(16).toString('hex');
const authUrl = new URL('https://www.linkedin.com/oauth/v2/authorization');
authUrl.searchParams.set('response_type', 'code');
authUrl.searchParams.set('client_id', env.LINKEDIN_CLIENT_ID);
authUrl.searchParams.set('redirect_uri', REDIRECT_URI);
authUrl.searchParams.set('scope', SCOPE);
authUrl.searchParams.set('state', state);

const TokenResponse = z.object({
  access_token: z.string(),
  expires_in: z.number().optional(),
});

const UserInfo = z.object({
  sub: z.string(),
  name: z.string().optional(),
  email: z.string().optional(),
});

async function exchangeCode(code: string): Promise<string> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: REDIRECT_URI,
    client_id: env.LINKEDIN_CLIENT_ID,
    client_secret: env.LINKEDIN_CLIENT_SECRET,
  });
  const res = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) throw new Error(`Token exchange failed: ${res.status} ${await res.text()}`);
  return TokenResponse.parse(await res.json()).access_token;
}

async function fetchMemberUrn(token: string): Promise<{ urn: string; name?: string }> {
  const res = await fetch('https://api.linkedin.com/v2/userinfo', {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`userinfo failed: ${res.status} ${await res.text()}`);
  const info = UserInfo.parse(await res.json());
  return { urn: `urn:li:person:${info.sub}`, ...(info.name ? { name: info.name } : {}) };
}

async function updateEnv(updates: Record<string, string>): Promise<void> {
  let current = '';
  try {
    current = await readFile('.env', 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
  const lines = current.split('\n');
  const remaining = new Map(Object.entries(updates));
  const next = lines.map((line) => {
    const m = line.match(/^([A-Z0-9_]+)=/);
    if (m && m[1] && remaining.has(m[1])) {
      const key = m[1];
      const value = remaining.get(key)!;
      remaining.delete(key);
      return `${key}=${value}`;
    }
    return line;
  });
  for (const [key, value] of remaining) next.push(`${key}=${value}`);
  await writeFile('.env', next.join('\n'));
}

function openBrowser(url: string): void {
  const cmd =
    process.platform === 'darwin'
      ? `open "${url}"`
      : process.platform === 'win32'
        ? `start "" "${url}"`
        : `xdg-open "${url}"`;
  exec(cmd, (err) => {
    if (err) console.error('Could not open browser automatically. Visit:\n' + url);
  });
}

async function main(): Promise<void> {
  const result = await new Promise<{ code: string }>((resolve, reject) => {
    const server = createServer((req, res) => {
      if (!req.url?.startsWith('/callback')) {
        res.writeHead(404).end();
        return;
      }
      const params = new URL(req.url, `http://localhost:${PORT}`).searchParams;
      const code = params.get('code');
      const returnedState = params.get('state');
      const error = params.get('error');
      if (error) {
        res.writeHead(400).end(`Auth error: ${error}`);
        server.close();
        reject(new Error(`LinkedIn returned error: ${error}`));
        return;
      }
      if (returnedState !== state || !code) {
        res.writeHead(400).end('Invalid state or missing code');
        server.close();
        reject(new Error('State mismatch or missing code'));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html' }).end(
        '<html><body><h2>Authenticated. You can close this tab.</h2></body></html>',
      );
      server.close();
      resolve({ code });
    });
    server.listen(PORT, () => {
      console.log(`Listening on http://localhost:${PORT}`);
      console.log('Opening browser for LinkedIn authorization...');
      openBrowser(authUrl.toString());
    });
    server.on('error', reject);
  });

  console.log('Exchanging code for access token...');
  const token = await exchangeCode(result.code);

  console.log('Fetching member URN...');
  const { urn, name } = await fetchMemberUrn(token);

  await updateEnv({ LINKEDIN_ACCESS_TOKEN: token, LINKEDIN_MEMBER_URN: urn });
  console.log(`Saved access token and member URN to .env${name ? ` (${name})` : ''}`);
}

main().catch((err: unknown) => {
  console.error('Auth failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});

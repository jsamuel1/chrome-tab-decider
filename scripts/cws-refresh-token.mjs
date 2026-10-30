#!/usr/bin/env node
// Get a Chrome Web Store API refresh token and store it as the CWS_REFRESH_TOKEN secret of each
// repo's chrome-web-store environment, without the token ever being printed. One token covers
// every item of the publisher.
//
//   node scripts/cws-refresh-token.mjs [--from-github] [owner/repo ...]
//
// Needs `gh` signed in, and a Google OAuth client of type "Desktop app" with the Chrome Web
// Store API enabled (a "Web application" client rejects the loopback redirect used here).
// If the OAuth consent screen is still in "Testing", Google expires the token after 7 days:
// publish the consent screen to "In production" first.
//
// Client ID and secret: by default they are prompted for (secret hidden), or read from
// CWS_CLIENT_ID and CWS_CLIENT_SECRET. With --from-github they never leave GitHub: the
// .github/workflows/cws-token.yml helper uses the environment secrets of the same names and
// returns its results encrypted to a key pair made for this run, held only in memory here.
// If the environment requires approval, the script prints the run to approve.
import http from 'node:http';
import { execFile, spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { constants, generateKeyPairSync, privateDecrypt, randomBytes } from 'node:crypto';
import { promisify } from 'node:util';

const SCOPE = 'https://www.googleapis.com/auth/chromewebstore';
const HELPER_REPO = 'jsamuel1/chrome-tab-decider';
const HELPER_WORKFLOW = 'cws-token.yml';
const ENVIRONMENT = 'chrome-web-store';

const args = process.argv.slice(2);
const fromGithub = args.includes('--from-github');
const repos = args.filter((a) => !a.startsWith('--'));
if (!repos.length) repos.push('jsamuel1/chrome-tab-decider', 'jsamuel1/chrome-copy-url');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const gh = async (ghArgs) => (await promisify(execFile)('gh', ghArgs, { maxBuffer: 64 << 20 })).stdout;

function ask(prompt, hidden = false) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) rl._writeToOutput = (s) => { if (s === prompt) rl.output.write(s); };
    rl.question(prompt, (answer) => {
      rl.close();
      if (hidden) process.stdout.write('\n');
      resolve(answer.trim());
    });
  });
}

// --from-github: run one step of the helper workflow and decrypt what it prints.
const keys = fromGithub ? generateKeyPairSync('rsa', { modulusLength: 2048 }) : null;
async function viaGithub(step, fields = {}) {
  const nonce = randomBytes(8).toString('hex');
  const publicKey = Buffer.from(keys.publicKey.export({ type: 'spki', format: 'pem' })).toString('base64');
  const runArgs = ['workflow', 'run', HELPER_WORKFLOW, '--repo', HELPER_REPO,
    '-f', `step=${step}`, '-f', `public_key=${publicKey}`, '-f', `nonce=${nonce}`];
  for (const [k, v] of Object.entries(fields)) runArgs.push('-f', `${k}=${v}`);
  await gh(runArgs);

  let id;
  for (let i = 0; i < 30 && !id; i++) {
    await sleep(2000);
    const runs = JSON.parse(await gh(['run', 'list', '--repo', HELPER_REPO, '--workflow', HELPER_WORKFLOW,
      '--limit', '20', '--json', 'databaseId,displayTitle']));
    id = runs.find((r) => r.displayTitle.endsWith(nonce))?.databaseId;
  }
  if (!id) throw new Error(`could not find the ${step} run of ${HELPER_WORKFLOW}`);
  const where = `gh run view ${id} --repo ${HELPER_REPO}`;

  let asked = false;
  for (;;) {
    const { status, conclusion, url } = JSON.parse(await gh(['run', 'view', String(id), '--repo', HELPER_REPO,
      '--json', 'status,conclusion,url']));
    if (status === 'waiting' && !asked) {
      console.log(`  Waiting for you to approve the ${step} run (Review deployments): ${url}`);
      asked = true;
    }
    if (status === 'completed') {
      if (conclusion === 'success') break;
      const failed = await gh(['run', 'view', String(id), '--repo', HELPER_REPO, '--log-failed']).catch(() => '');
      const reason = failed.match(/##\[error\](.*)/)?.[1]?.trim();
      throw new Error(`the ${step} run ${conclusion}${reason ? `: ${reason}` : ''} (${where})`);
    }
    await sleep(3000);
  }

  // Logs can lag a few seconds behind the run finishing.
  for (let i = 0; i < 10; i++) {
    const log = await gh(['run', 'view', String(id), '--repo', HELPER_REPO, '--log']).catch(() => '');
    const sealed = log.match(/SEALED:([A-Za-z0-9+/=]{100,})/)?.[1];
    if (sealed) {
      return privateDecrypt({ key: keys.privateKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
        Buffer.from(sealed, 'base64')).toString();
    }
    await sleep(3000);
  }
  throw new Error(`no sealed result in the ${step} run's log (${where})`);
}

let clientId, clientSecret;
if (fromGithub) {
  console.log('Fetching the OAuth client ID from GitHub…');
  clientId = await viaGithub('client-id');
} else {
  clientId = process.env.CWS_CLIENT_ID || (await ask('OAuth client ID: '));
  clientSecret = process.env.CWS_CLIENT_SECRET || (await ask('OAuth client secret (hidden): ', true));
  if (!clientId || !clientSecret) throw new Error('client ID and secret are both required');
}

// Loopback redirect on a random free port; `state` ties the reply to this run.
const state = randomBytes(16).toString('hex');
const server = http.createServer();
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const redirectUri = `http://127.0.0.1:${server.address().port}`;

const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
authUrl.search = new URLSearchParams({
  client_id: clientId,
  redirect_uri: redirectUri,
  response_type: 'code',
  scope: SCOPE,
  access_type: 'offline',
  prompt: 'consent', // always returns a refresh token, even if one was granted before
  state,
});

const code = await new Promise((resolve, reject) => {
  server.on('request', (req, res) => {
    const q = new URL(req.url, redirectUri).searchParams;
    if (!q.has('code') && !q.has('error')) return res.writeHead(404).end(); // e.g. favicon
    const ok = q.get('state') === state && q.get('code');
    res.writeHead(200, { 'Content-Type': 'text/plain' })
      .end(ok ? 'Done. You can close this tab.' : `Failed: ${q.get('error') ?? 'state mismatch'}`);
    server.close();
    ok ? resolve(q.get('code')) : reject(new Error(`authorization failed: ${q.get('error') ?? 'state mismatch'}`));
  });
  console.log(`Approve access in your browser. If it does not open, visit:\n${authUrl.href}\n`);
  spawn('open', [authUrl.href], { stdio: 'ignore' }).on('error', () => {});
});

let refreshToken;
if (fromGithub) {
  console.log('Exchanging the code on GitHub…');
  refreshToken = await viaGithub('exchange', { code, redirect_uri: redirectUri });
} else {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  });
  const body = await res.json();
  // Only the error fields are ever shown; the body holds the tokens.
  if (!res.ok || !body.refresh_token) {
    throw new Error(`token exchange failed: ${body.error ?? res.status} ${body.error_description ?? ''}`.trim());
  }
  if (!String(body.scope ?? '').split(' ').includes(SCOPE)) {
    throw new Error('the token was granted without the Chrome Web Store scope');
  }
  refreshToken = body.refresh_token;
}

for (const repo of repos) {
  await new Promise((resolve, reject) => {
    const proc = spawn('gh', ['secret', 'set', 'CWS_REFRESH_TOKEN', '--repo', repo, '--env', ENVIRONMENT], {
      stdio: ['pipe', 'inherit', 'inherit'],
    });
    proc.on('error', reject);
    proc.on('exit', (status) => (status === 0 ? resolve() : reject(new Error(`gh secret set failed for ${repo}`))));
    proc.stdin.end(refreshToken);
  });
}
console.log(`CWS_REFRESH_TOKEN set in the ${ENVIRONMENT} environment of ${repos.join(', ')}.`);

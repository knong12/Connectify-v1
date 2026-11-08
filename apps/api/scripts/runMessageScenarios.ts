import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import dotenv from 'dotenv';
import express from 'express';
import jwt from 'jsonwebtoken';

type Scenario = 'Unfollowing' | 'Acceptance' | 'Decline' | 'Established chat after unfollowing';
type Check = { description: string; expected: unknown; actual: unknown; passed: boolean };
type Attempt = {
  attemptId: string; round: string; scenario: Scenario; method: string;
  outcome: 'Passed' | 'Failed' | 'Blocked'; durationMs: number | null;
  checks: Check[]; error: string | null;
};

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const outputDirectory = resolve(root, process.argv[2] ?? 'docs/testing/message-consent-v2');
const settings = dotenv.parse(await readFile(resolve(root, 'apps/api/.env')));
const sourceUrl = process.env.TEST_DATABASE_URL ?? settings.DATABASE_URL;
if (!sourceUrl) throw new Error('Set TEST_DATABASE_URL or configure apps/api/.env DATABASE_URL.');
const databaseUrl = new URL(sourceUrl);
if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(databaseUrl.hostname)) {
  throw new Error('This script only runs against local PostgreSQL. Use a separate local test database.');
}
const schemaName = `connectify_msgtest_${randomBytes(8).toString('hex')}`;
databaseUrl.searchParams.set('schema', schemaName);
process.env.DATABASE_URL = databaseUrl.toString();
process.env.JWT_SECRET = randomBytes(32).toString('hex');
process.env.CLIENT_URL = 'http://127.0.0.1:5173';
process.env.SPOTIFY_CLIENT_ID = 'automated-test-no-spotify-calls';
process.env.SPOTIFY_CLIENT_SECRET = 'automated-test-no-spotify-calls';
process.env.SPOTIFY_REDIRECT_URI = 'http://127.0.0.1:5000/api/auth/spotify/callback';

const scenarios: Scenario[] = ['Unfollowing', 'Acceptance', 'Decline', 'Established chat after unfollowing'];
const attempts: Attempt[] = Array.from({ length: 5 }, (_, index) => scenarios.map((scenario, offset) => ({
  attemptId: `A${String(index * 4 + offset + 1).padStart(2, '0')}`,
  round: `R${index + 1}`, scenario, method: 'Automated HTTP + PostgreSQL integration',
  outcome: 'Blocked' as const, durationMs: null, checks: [], error: null
}))).flat();
const startedAt = new Date().toISOString();
let cleanup = 'Not required; migration not attempted.';
let setupError: string | null = null;
let prisma: Awaited<typeof import('../src/lib/prisma.js')>['prisma'] | undefined;
let server: ReturnType<typeof createServer> | undefined;
let migrationAttempted = false;
let integrationSuite: { status: number | null; output: string } | null = null;
const migrationChecks: Check[] = [];
const safeError = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, '[database URL redacted]')
    .replaceAll(sourceUrl, '[database URL redacted]').slice(0, 1500);
};

try {
  migrationAttempted = true;
  const migration = spawnSync(process.execPath, [
    resolve(root, 'node_modules/prisma/build/index.js'), 'migrate', 'deploy',
    '--schema', resolve(root, 'apps/api/prisma/schema.prisma')
  ], { cwd: resolve(root, 'apps/api'), env: process.env, encoding: 'utf8', timeout: 60_000 });
  if (migration.status !== 0) {
    throw new Error(`Isolated-schema migration failed: ${safeError(migration.error ?? migration.stderr ?? 'unknown error')}`);
  }
  ({ prisma } = await import('../src/lib/prisma.js'));
  const { createConversationRoutes } = await import('../src/routes/conversations.js');
  const { default: follows } = await import('../src/routes/follows.js');
  const activeSchema = await prisma.$queryRawUnsafe<{ schema: string }[]>('SELECT current_schema() AS schema');
  assert.equal(activeSchema[0]?.schema, schemaName, 'Refusing tests outside the isolated schema');
  // Reapply the data migration to representative pre-upgrade records in this schema only.
  const legacyIds = [randomUUID(), randomUUID(), randomUUID(), randomUUID()].sort();
  await prisma.user.createMany({ data: legacyIds.map((id) => ({
    id, email: `${id}@migration-test.invalid`, spotifyUserId: `migration-${id}`, displayName: 'Migration fixture'
  })) });
  const legacy = await prisma.conversation.create({ data: { memberAId: legacyIds[0], memberBId: legacyIds[1],
    messages: { create: { senderId: legacyIds[0], clientMessageId: randomUUID(), body: 'Established before upgrade' } }
  } });
  const empty = await prisma.conversation.create({ data: { memberAId: legacyIds[0], memberBId: legacyIds[2] } });
  const pending = await prisma.conversation.create({ data: { memberAId: legacyIds[1], memberBId: legacyIds[2], status: 'pending', requesterId: legacyIds[1] } });
  const declined = await prisma.conversation.create({ data: { memberAId: legacyIds[2], memberBId: legacyIds[3], status: 'declined', requesterId: legacyIds[2] } });
  const migrationSql = await readFile(resolve(root, 'apps/api/prisma/migrations/20261107000000_persist_established_chat_consent/migration.sql'), 'utf8');
  await prisma.$executeRawUnsafe(migrationSql);
  for (const [id, expected, description] of [
    [legacy.id, 'accepted', 'Previously paused chat regains established permission'],
    [empty.id, 'mutual', 'Empty chat gains no lasting permission'],
    [pending.id, 'pending', 'Pending consent is preserved'],
    [declined.id, 'declined', 'Declined consent is preserved']
  ]) {
    const actual = (await prisma.conversation.findUniqueOrThrow({ where: { id } })).status;
    migrationChecks.push({ description, expected, actual, passed: actual === expected });
    assert.equal(actual, expected, description);
  }
  const app = express();
  app.use(express.json());
  app.use('/api/conversations', createConversationRoutes(() => {}));
  app.use('/api/follows', follows);
  app.use((_error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(500).json({ code: 'unexpected_test_server_error' });
  });
  server = createServer(app);
  await new Promise<void>((accept) => server!.listen(0, '127.0.0.1', accept));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const origin = `http://127.0.0.1:${address.port}`;

  for (const attempt of attempts) {
    const started = performance.now();
    try {
      const ids = [randomUUID(), randomUUID()];
      const tokens = ids.map((userId) => jwt.sign({ userId }, process.env.JWT_SECRET!, { expiresIn: '10m' }));
      await prisma.user.createMany({ data: ids.map((id, index) => ({
        id, email: `${id}@scenario-test.invalid`, spotifyUserId: `fixture-${id}`,
        displayName: `Fixture ${attempt.attemptId} ${index}`
      })) });
      const check = (description: string, actual: unknown, expected: unknown) => {
        let passed = true;
        try { assert.deepEqual(actual, expected); } catch { passed = false; }
        attempt.checks.push({ description, expected, actual, passed });
        assert.ok(passed, `${description}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
      };
      const request = async (who: number, path: string, method = 'GET', body?: unknown) => {
        const response = await fetch(`${origin}/api/${path}`, {
          method, headers: { Authorization: `Bearer ${tokens[who]}`, 'Content-Type': 'application/json' },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(10_000)
        });
        return { status: response.status, data: await response.json() };
      };
      const message = (text: string) => ({ body: text, clientMessageId: randomUUID() });
      const followBoth = async () => {
        check('First follow succeeds', (await request(0, `follows/${ids[1]}`, 'POST')).status, 201);
        check('Reciprocal follow succeeds', (await request(1, `follows/${ids[0]}`, 'POST')).status, 201);
      };
      const open = async () => {
        const response = await request(0, 'conversations', 'POST', { targetUserId: ids[1] });
        check('Open conversation succeeds', response.status, 201);
        return response.data.conversation;
      };

      if (attempt.scenario === 'Unfollowing') {
        await followBoth();
        const conversation = await open();
        check('Empty chat begins mutual', conversation.status, 'mutual');
        check('Unfollow succeeds', (await request(0, `follows/${ids[1]}`, 'DELETE')).status, 200);
        const preview = (await request(0, `conversations/${conversation.id}`)).data.conversation;
        check('Empty former mutual chat requires a request', preview.requiresRequest, true);
        const introduction = message('One introduction after unfollowing');
        const first = await request(0, `conversations/${conversation.id}/messages`, 'POST', introduction);
        check('One introduction is accepted', first.status, 201);
        const retry = await request(0, `conversations/${conversation.id}/messages`, 'POST', introduction);
        check('Exact retry reuses the saved message', retry.data.message.id, first.data.message.id);
        check('Second new introduction blocked', (await request(0, `conversations/${conversation.id}/messages`, 'POST', message('Second introduction'))).status, 403);
        check('Reply before acceptance blocked', (await request(1, `conversations/${conversation.id}/messages`, 'POST', message('Early reply'))).status, 403);
        const recipient = (await request(1, `conversations/${conversation.id}`)).data.conversation;
        check('Chat becomes pending', recipient.status, 'pending');
        check('Recipient sees incoming request', recipient.requestDirection, 'incoming');
        const folder = await request(1, 'conversations?folder=requests');
        check('Request appears in request folder', folder.data.conversations.some((row: { id: string }) => row.id === conversation.id), true);
        check('Only one message persisted', await prisma.message.count({ where: { conversationId: conversation.id } }), 1);
      } else if (attempt.scenario === 'Acceptance') {
        const conversation = await open();
        check('Non-mutual chat begins pending', conversation.status, 'pending');
        check('Introduction accepted', (await request(0, `conversations/${conversation.id}/messages`, 'POST', message('Please connect'))).status, 201);
        check('Sender cannot accept own request', (await request(0, `conversations/${conversation.id}/request`, 'POST', { decision: 'accepted' })).status, 403);
        const accepted = await request(1, `conversations/${conversation.id}/request`, 'POST', { decision: 'accepted' });
        check('Recipient accepts', accepted.status, 200);
        check('Accepted state persists', accepted.data.conversation.status, 'accepted');
        check('Recipient may send', (await request(1, `conversations/${conversation.id}/messages`, 'POST', message('Accepted reply'))).status, 201);
        check('Requester may send again', (await request(0, `conversations/${conversation.id}/messages`, 'POST', message('Thanks'))).status, 201);
        check('Acceptance needs no follow relationship', await prisma.follow.count({ where: { followerId: { in: ids }, followingId: { in: ids } } }), 0);
        check('Incoming request count clears', (await request(1, 'conversations')).data.requestTotal, 0);
        check('Three messages persisted', await prisma.message.count({ where: { conversationId: conversation.id } }), 3);
        await followBoth();
        for (const who of [0, 1]) {
          check(`Accepted participant ${who} unfollows`, (await request(who, `follows/${ids[1 - who]}`, 'DELETE')).status, 200);
        }
        for (const who of [0, 1]) {
          check(`Accepted participant ${who} remains able to send`, (await request(who, `conversations/${conversation.id}`)).data.conversation.canSend, true);
          check(`Accepted participant ${who} sends after unfollowing`, (await request(who, `conversations/${conversation.id}/messages`, 'POST', message('Still accepted'))).status, 201);
        }
        const requests = await request(1, 'conversations?folder=requests');
        check('Accepted chat stays out of requests', requests.data.conversations.some((row: { id: string }) => row.id === conversation.id), false);
        check('Accepted chat remains in regular inbox', (await request(1, 'conversations')).data.conversations.some((row: { id: string }) => row.id === conversation.id), true);
      } else if (attempt.scenario === 'Decline') {
        const conversation = await open();
        check('Introduction accepted', (await request(0, `conversations/${conversation.id}/messages`, 'POST', message('Introduction to decline'))).status, 201);
        const declined = await request(1, `conversations/${conversation.id}/request`, 'POST', { decision: 'declined' });
        check('Recipient declines', declined.status, 200);
        check('Declined state persists', declined.data.conversation.status, 'declined');
        await followBoth();
        check('Requester send blocked', (await request(0, `conversations/${conversation.id}/messages`, 'POST', message('Blocked followup'))).status, 403);
        check('Recipient send blocked', (await request(1, `conversations/${conversation.id}/messages`, 'POST', message('Blocked reply'))).status, 403);
        const reopened = await open();
        check('Reopen reuses same conversation', reopened.id, conversation.id);
        check('Reopen does not reset decline', reopened.status, 'declined');
        check('Decline cannot be overwritten by acceptance', (await request(1, `conversations/${conversation.id}/request`, 'POST', { decision: 'accepted' })).status, 409);
        check('No extra message persisted', await prisma.message.count({ where: { conversationId: conversation.id } }), 1);
      } else {
        await followBoth();
        const conversation = await open();
        check('Chat begins mutual, not accepted request', conversation.status, 'mutual');
        check('Original sender message accepted', (await request(0, `conversations/${conversation.id}/messages`, 'POST', message('Existing message'))).status, 201);
        check('First mutual message persists lasting consent', (await prisma.conversation.findUniqueOrThrow({ where: { id: conversation.id } })).status, 'accepted');
        for (const who of [0, 1]) {
          check(`Participant ${who} unfollows`, (await request(who, `follows/${ids[1 - who]}`, 'DELETE')).status, 200);
        }
        for (const who of [0, 1]) {
          const preview = (await request(who, `conversations/${conversation.id}`)).data.conversation;
          check(`Participant ${who} can still send`, preview.canSend, true);
          check(`Participant ${who} does not get a fresh introduction`, preview.requiresRequest, false);
          check(`Participant ${who} reopens the same accepted chat`, (await request(who, 'conversations', 'POST', { targetUserId: ids[1 - who] })).data.conversation.status, 'accepted');
          const sent = await request(who, `conversations/${conversation.id}/messages`, 'POST', message('Still open after unfollowing'));
          check(`Participant ${who} sends without refollowing`, sent.status, 201);
          check(`Participant ${who} can read all saved messages`, (await request(who, `conversations/${conversation.id}/messages`)).data.messages.length, who + 2);
        }
        check('No follows needed for established chat', await prisma.follow.count({ where: { followerId: { in: ids }, followingId: { in: ids } } }), 0);
        check('Exactly three messages persisted', await prisma.message.count({ where: { conversationId: conversation.id } }), 3);
      }
      attempt.outcome = 'Passed';
    } catch (error) {
      attempt.outcome = 'Failed';
      attempt.error = safeError(error);
    }
    attempt.durationMs = Math.round((performance.now() - started) * 100) / 100;
    console.log(`${attempt.attemptId} ${attempt.round} ${attempt.scenario}: ${attempt.outcome} (${attempt.checks.length} checks)`);
  }
  if (process.argv.includes('--with-integration-tests')) {
    const suite = spawnSync(process.execPath, ['--import', 'tsx', '--test',
      'apps/api/tests/messageRequests.test.ts', 'apps/api/tests/messaging.test.ts'
    ], { cwd: root, env: { ...process.env, RUN_MESSAGING_DB_TESTS: '1' }, encoding: 'utf8', timeout: 90_000 });
    integrationSuite = { status: suite.status, output: safeError(suite.error ?? '') + suite.stdout + suite.stderr };
    console.log(integrationSuite.output);
    if (suite.status !== 0) process.exitCode = 1;
  }
} catch (error) {
  setupError = safeError(error);
  for (const attempt of attempts) attempt.error = setupError;
  console.error(`Test setup blocked: ${setupError}`);
} finally {
  if (server?.listening) {
    server.closeAllConnections();
    await new Promise<void>((accept) => server!.close(() => accept()));
  }
  if (migrationAttempted) {
    try {
      if (!prisma) ({ prisma } = await import('../src/lib/prisma.js'));
      assert.match(schemaName, /^connectify_msgtest_[a-f0-9]{16}$/);
      assert.equal(new URL(process.env.DATABASE_URL!).searchParams.get('schema'), schemaName);
      await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
      cleanup = 'Isolated test schema and all fixture data removed.';
    } catch (error) {
      cleanup = `Cleanup failed for ${schemaName}: ${safeError(error)}`;
      process.exitCode = 1;
    }
  }
  await prisma?.$disconnect();
}

const result = {
  policyVersion: 'persistent-consent-v2', migrationChecks, integrationSuite,
  startedAt, finishedAt: new Date().toISOString(), method: 'Automated HTTP + real PostgreSQL integration',
  humanTesters: 0, humanTaskAttempts: 0, automatedRounds: 5,
  scope: 'Real Express routes, auth middleware, follow operations, messaging services and isolated PostgreSQL schema. No browser usability, real Spotify, or live socket delivery measured.',
  schemaName, cleanup, setupError,
  summary: {
    total: attempts.length, passed: attempts.filter((row) => row.outcome === 'Passed').length,
    failed: attempts.filter((row) => row.outcome === 'Failed').length,
    blocked: attempts.filter((row) => row.outcome === 'Blocked').length,
    assertions: attempts.reduce((sum, row) => sum + row.checks.length, 0)
  }, attempts
};
await mkdir(outputDirectory, { recursive: true });
await writeFile(resolve(outputDirectory, 'automated-results.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ ...result.summary, cleanup, humanTaskAttempts: 0 }));
if (result.summary.failed || result.summary.blocked) process.exitCode = 1;

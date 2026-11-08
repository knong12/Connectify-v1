import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { test } from 'node:test';
import express from 'express';
import jwt from 'jsonwebtoken';
import { io as client, type Socket } from 'socket.io-client';

test('message request consent, concurrency, inboxes, and private notifications', {
  skip: process.env.RUN_MESSAGING_DB_TESTS !== '1', timeout: 40_000
}, async (t) => {
  const { env } = await import('../src/config/env.js');
  const { prisma } = await import('../src/lib/prisma.js');
  const { createMessagingServer } = await import('../src/realtime/messaging.js');
  const { createConversationRoutes } = await import('../src/routes/conversations.js');
  const ids = Array.from({ length: 36 }, () => randomUUID());
  const tokens = ids.map((userId) => jwt.sign({ userId }, env.JWT_SECRET, { expiresIn: '5m' }));
  const app = express(); app.use(express.json());
  const server = createServer(app);
  const io = createMessagingServer(server);
  app.use('/api/conversations', createConversationRoutes((users, event, payload) => {
    io.to(users.map((id) => `user:${id}`)).emit(event, payload);
  }));
  const sockets: Socket[] = [];
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const origin = `http://127.0.0.1:${address.port}`;
  async function request(who: number | null, path = '', body?: unknown) {
    const response = await fetch(`${origin}/api/conversations${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { ...(who === null ? {} : { Authorization: `Bearer ${tokens[who]}` }), 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    return { status: response.status, data: await response.json() };
  }
  async function connect(who: number) {
    const socket = client(origin, { auth: { token: tokens[who] }, transports: ['websocket'], reconnection: false });
    sockets.push(socket);
    await new Promise<void>((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject); });
    return socket;
  }
  const message = (body: string) => ({ body, clientMessageId: randomUUID() });
  try {
    await prisma.user.createMany({ data: ids.map((id, index) => ({
      id, email: `${id}@requests-test.invalid`, spotifyUserId: `request-test-${id}`, displayName: `Request fixture ${index}`
    })) });
    const recipient = await connect(1);
    const outsider = await connect(2);
    const events: string[] = [];
    outsider.onAny((event) => events.push(event));
    const arrival = new Promise<{ conversationId: string }>((resolve) => recipient.once('inbox:changed', resolve));
    const started = await request(0, '', { targetUserId: ids[1] });
    assert.equal(started.status, 201);
    const id = started.data.conversation.id;

    await t.test('requests notify only participants and appear in the recipient request folder', async () => {
      assert.equal((await arrival).conversationId, id);
      assert.equal(started.data.conversation.status, 'pending');
      assert.equal(started.data.conversation.requestDirection, 'outgoing');
      assert.equal(started.data.conversation.canSend, true);
      const inbox = await request(1);
      assert.equal(inbox.data.requestTotal, 1);
      assert.equal(inbox.data.conversations.length, 0);
      const requests = await request(1, '?folder=requests');
      assert.equal(requests.data.conversations[0].id, id);
      assert.equal(requests.data.conversations[0].canSend, false);
      assert.equal(requests.data.conversations[0].requestDirection, 'incoming');
      assert.equal((await request(0)).data.conversations[0].id, id);
      assert.equal((await request(2, `/${id}`)).status, 404);
      assert.equal(events.length, 0);
    });

    await t.test('repeated and reciprocal starts reuse the request without accepting it', async () => {
      const [repeat, reciprocal] = await Promise.all([
        request(0, '', { targetUserId: ids[1] }), request(1, '', { targetUserId: ids[0] })
      ]);
      assert.equal(repeat.data.conversation.id, id);
      assert.equal(reciprocal.data.conversation.id, id);
      assert.equal(reciprocal.data.conversation.status, 'pending');
      assert.equal(await prisma.conversation.count({ where: { id } }), 1);
    });

    await t.test('only one introduction is saved under concurrent sends and exact retries remain safe', async () => {
      const a = message('Hello, we share an artist');
      const b = message('Another introduction');
      const results = await Promise.all([request(0, `/${id}/messages`, a), request(0, `/${id}/messages`, b)]);
      assert.deepEqual(results.map((result) => result.status).sort(), [201, 403]);
      const successful = results[0].status === 201 ? a : b;
      const saved = results.find((result) => result.status === 201)!.data.message;
      assert.equal((await request(0, `/${id}/messages`, successful)).data.message.id, saved.id);
      assert.equal(await prisma.message.count({ where: { conversationId: id } }), 1);
      assert.equal((await request(1, `/${id}/messages`, message('Not accepted yet'))).status, 403);
      assert.equal((await request(0, `/${id}`)).data.conversation.canSend, false);
      assert.equal((await request(1)).data.unreadTotal, 0);
      assert.equal((await request(1)).data.requestTotal, 1);
    });

    await t.test('only the recipient may accept; acceptance enables both users without follows', async () => {
      assert.equal((await request(null, `/${id}/request`, { decision: 'accepted' })).status, 401);
      assert.equal((await request(0, `/${id}/request`, { decision: 'accepted' })).status, 403);
      assert.equal((await request(2, `/${id}/request`, { decision: 'accepted' })).status, 404);
      assert.equal((await request(1, `/${id}/request`, { decision: 'other' })).status, 400);
      assert.equal((await request(1, `/${id}/request`, { decision: 'accepted', requesterId: ids[1] })).status, 400);
      assert.equal((await request(1, `/${id}/request`, { decision: 'accepted' })).data.conversation.canSend, true);
      assert.equal((await request(1, `/${id}/request`, { decision: 'accepted' })).status, 200);
      assert.equal((await request(1, `/${id}/request`, { decision: 'declined' })).status, 409);
      assert.equal((await request(0, `/${id}/messages`, message('Thanks for accepting'))).status, 201);
      assert.equal((await request(1, `/${id}/messages`, message('Happy to connect'))).status, 201);
      assert.equal((await request(1)).data.requestTotal, 0);
      assert.equal((await request(1, '?folder=requests')).data.conversations.length, 0);
      assert.equal((await request(1)).data.conversations[0].status, 'accepted');
      assert.equal(await prisma.follow.count({ where: { followerId: { in: ids }, followingId: { in: ids } } }), 0);
    });

    await t.test('declined requests cannot send or restart even after following each other', async () => {
      const started = await request(2, '', { targetUserId: ids[1] });
      const declinedId = started.data.conversation.id;
      assert.equal((await request(1, `/${declinedId}/request`, { decision: 'declined' })).status, 200);
      assert.equal((await request(1, `/${declinedId}/request`, { decision: 'declined' })).status, 200);
      await prisma.follow.createMany({ data: [
        { followerId: ids[2], followingId: ids[1] }, { followerId: ids[1], followingId: ids[2] }
      ] });
      const restarted = await request(2, '', { targetUserId: ids[1] });
      assert.equal(restarted.data.conversation.id, declinedId);
      assert.equal(restarted.data.conversation.status, 'declined');
      assert.equal((await request(2, `/${declinedId}/messages`, message('Blocked'))).status, 403);
      assert.equal((await request(1, `/${declinedId}/messages`, message('Also blocked'))).status, 403);
      assert.equal((await request(1, `/${declinedId}/request`, { decision: 'accepted' })).status, 409);
      assert.equal((await request(1)).data.conversations.some((row: { id: string }) => row.id === declinedId), false);
    });

    await t.test('competing decisions cannot overwrite one another', async () => {
      const started = await request(3, '', { targetUserId: ids[1] });
      const raceId = started.data.conversation.id;
      const results = await Promise.all([
        request(1, `/${raceId}/request`, { decision: 'accepted' }), request(1, `/${raceId}/request`, { decision: 'declined' })
      ]);
      assert.deepEqual(results.map((result) => result.status).sort(), [200, 409]);
    });

    await t.test('opening a mutual chat then unfollowing converts only its first message into a request', async () => {
      await prisma.follow.createMany({ data: [
        { followerId: ids[4], followingId: ids[5] }, { followerId: ids[5], followingId: ids[4] }
      ] });
      const opened = await request(4, '', { targetUserId: ids[5] });
      const emptyId = opened.data.conversation.id;
      assert.equal(opened.data.conversation.status, 'mutual');
      assert.equal(opened.data.conversation.requiresRequest, false);
      await prisma.follow.delete({ where: { followerId_followingId: { followerId: ids[4], followingId: ids[5] } } });
      const preview = (await request(4, `/${emptyId}`)).data.conversation;
      assert.equal(preview.canSend, true);
      assert.equal(preview.requiresRequest, true);
      assert.equal(preview.status, 'mutual');
      assert.equal((await request(4, `/${emptyId}/messages`, message('   '))).status, 400);
      assert.equal((await prisma.conversation.findUniqueOrThrow({ where: { id: emptyId } })).status, 'mutual');
      const intro = message('An introduction after unfollowing');
      const sent = await request(4, `/${emptyId}/messages`, intro);
      assert.equal(sent.status, 201);
      assert.equal((await request(4, `/${emptyId}/messages`, intro)).data.message.id, sent.data.message.id);
      const pending = (await request(5, `/${emptyId}`)).data.conversation;
      assert.equal(pending.status, 'pending');
      assert.equal(pending.requestDirection, 'incoming');
      assert.equal(pending.requiresRequest, false);
      assert.equal(pending.canSend, false);
      assert.equal((await request(5, '?folder=requests')).data.conversations[0].id, emptyId);
      assert.equal((await request(5)).data.conversations.length, 0);
      assert.equal((await request(4, `/${emptyId}/messages`, message('Second intro'))).status, 403);
      assert.equal((await request(5, `/${emptyId}/messages`, message('Reply before acceptance'))).status, 403);
      assert.equal((await request(4, `/${emptyId}/request`, { decision: 'accepted' })).status, 403);
      assert.equal((await request(5, `/${emptyId}/request`, { decision: 'accepted' })).status, 200);
      assert.equal((await request(5, `/${emptyId}/messages`, message('Accepted reply'))).status, 201);
    });

    await t.test('competing first sends after unfollowing create one introduction with the actual sender', async () => {
      await prisma.follow.createMany({ data: [
        { followerId: ids[6], followingId: ids[7] }, { followerId: ids[7], followingId: ids[6] }
      ] });
      const opened = await request(6, '', { targetUserId: ids[7] });
      const emptyId = opened.data.conversation.id;
      await prisma.follow.deleteMany({ where: { followerId: ids[6], followingId: ids[7] } });
      const results = await Promise.all([
        request(6, `/${emptyId}/messages`, message('First contender')),
        request(7, `/${emptyId}/messages`, message('Second contender'))
      ]);
      assert.deepEqual(results.map(r => r.status).sort(), [201, 403]);
      const senderId = results.find(r => r.status === 201)!.data.message.senderId;
      const saved = await prisma.conversation.findUniqueOrThrow({ where: { id: emptyId } });
      assert.equal(saved.status, 'pending');
      assert.equal(saved.requesterId, senderId);
      assert.equal(await prisma.message.count({ where: { conversationId: emptyId } }), 1);
    });

    await t.test('the first mutual message establishes lasting consent after both users unfollow', async () => {
      await prisma.follow.createMany({ data: [
        { followerId: ids[8], followingId: ids[9] }, { followerId: ids[9], followingId: ids[8] }
      ] });
      const opened = await request(8, '', { targetUserId: ids[9] });
      const historyId = opened.data.conversation.id;
      assert.equal((await request(8, `/${historyId}/messages`, message('Original mutual message'))).status, 201);
      await prisma.follow.deleteMany({ where: { followerId: { in: [ids[8], ids[9]] }, followingId: { in: [ids[8], ids[9]] } } });
      for (const who of [8, 9]) {
        const preview = (await request(who, `/${historyId}`)).data.conversation;
        assert.equal(preview.canSend, true);
        assert.equal(preview.requiresRequest, false);
        assert.equal((await request(who, `/${historyId}/messages`, message('Still open after unfollowing'))).status, 201);
      }
      const saved = await prisma.conversation.findUniqueOrThrow({ where: { id: historyId } });
      assert.equal(saved.status, 'accepted');
      assert.equal(saved.requesterId, null);
      assert.equal((await request(9, `/${historyId}/messages`)).data.messages.length, 3);
    });

    await t.test('following and unfollowing cannot bypass a pending request', async () => {
      const opened = await request(10, '', { targetUserId: ids[11] });
      const pendingId = opened.data.conversation.id;
      assert.equal((await request(10, `/${pendingId}/messages`, message('One introduction'))).status, 201);
      await prisma.follow.createMany({ data: [
        { followerId: ids[10], followingId: ids[11] }, { followerId: ids[11], followingId: ids[10] }
      ] });
      for (const who of [10, 11]) {
        assert.equal((await request(who, `/${pendingId}/messages`, message('Cannot bypass consent'))).status, 403);
      }
      await prisma.follow.deleteMany({ where: { followerId: { in: [ids[10], ids[11]] }, followingId: { in: [ids[10], ids[11]] } } });
      assert.equal((await request(11, `/${pendingId}`)).data.conversation.status, 'pending');
      assert.equal((await request(11, `/${pendingId}/request`, { decision: 'accepted' })).status, 200);
      assert.equal((await request(10, `/${pendingId}/messages`, message('Now accepted'))).status, 201);
      assert.equal((await request(11, `/${pendingId}/messages`, message('Still accepted without follows'))).status, 201);
    });

    await t.test('invalid first messages grant no consent and concurrent mutual sends establish it once', async () => {
      await prisma.follow.createMany({ data: [
        { followerId: ids[12], followingId: ids[13] }, { followerId: ids[13], followingId: ids[12] }
      ] });
      const opened = await request(12, '', { targetUserId: ids[13] });
      const mutualId = opened.data.conversation.id;
      assert.equal((await request(12, `/${mutualId}/messages`, message('   '))).status, 400);
      assert.equal((await prisma.conversation.findUniqueOrThrow({ where: { id: mutualId } })).status, 'mutual');
      const results = await Promise.all([
        request(12, `/${mutualId}/messages`, message('First mutual send')),
        request(13, `/${mutualId}/messages`, message('Second mutual send'))
      ]);
      assert.deepEqual(results.map(result => result.status), [201, 201]);
      assert.equal((await prisma.conversation.findUniqueOrThrow({ where: { id: mutualId } })).status, 'accepted');
      assert.equal(await prisma.message.count({ where: { conversationId: mutualId } }), 2);
    });

    await t.test('request paging is independent of the main inbox and validates cursors', async () => {
      await prisma.conversation.createMany({ data: ids.slice(4).map((sender) => {
        const [memberAId, memberBId] = [sender, ids[1]].sort();
        return { memberAId, memberBId, status: 'pending' as const, requesterId: sender };
      }) });
      const first = await request(1, '?folder=requests');
      assert.equal(first.data.conversations.length, 30);
      assert.ok(first.data.requestTotal >= 32);
      const next = await request(1, `?folder=requests&before=${first.data.nextCursor}`);
      const combined = [...first.data.conversations, ...next.data.conversations];
      assert.equal(new Set(combined.map((row) => row.id)).size, first.data.requestTotal);
      const boundary = first.data.nextCursor;
      await request(1, `/${boundary}/request`, { decision: 'accepted' });
      const afterResolution = await request(1, `?folder=requests&before=${boundary}`);
      assert.deepEqual(afterResolution.data.conversations.map((row: { id: string }) => row.id), next.data.conversations.map((row: { id: string }) => row.id));
      assert.equal((await request(2, `?folder=requests&before=${id}`)).status, 404);
      assert.equal((await request(1, '?folder=invalid')).status, 400);
    });
  } finally {
    for (const socket of sockets) socket.disconnect();
    await new Promise<void>((resolve) => io.close(() => resolve()));
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
    await prisma.$disconnect();
  }
});

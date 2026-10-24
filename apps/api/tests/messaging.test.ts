import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';
import express from 'express';
import jwt from 'jsonwebtoken';
import { io as client, type Socket } from 'socket.io-client';

// Integration tests opt in and create/delete only their own random fixture users.
test('messaging REST, persistence, private delivery, and access controls', {
  skip: process.env.RUN_MESSAGING_DB_TESTS !== '1', timeout: 30_000
}, async (t) => {
  const { env } = await import('../src/config/env.js');
  const { prisma } = await import('../src/lib/prisma.js');
  const { createMessagingServer } = await import('../src/realtime/messaging.js');
  const { createConversationRoutes } = await import('../src/routes/conversations.js');
  const app = express(); app.use(express.json());
  const server = createServer(app); const io = createMessagingServer(server);
  app.use('/api/conversations', createConversationRoutes((users, event, data) => io.to(users.map((id) => `user:${id}`)).emit(event, data)));
  const ids = [randomUUID(), randomUUID(), randomUUID()];
  const sockets: Socket[] = [];
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const origin = `http://127.0.0.1:${address.port}`;
  const tokens = ids.map((userId) => jwt.sign({ userId }, env.JWT_SECRET, { expiresIn: '5m' }));
  async function request(who: number | null, path = '', body?: unknown) {
    const response = await fetch(`${origin}/api/conversations${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { ...(who === null ? {} : { Authorization: `Bearer ${tokens[who]}` }), 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    return { status: response.status, data: await response.json(), headers: response.headers };
  }
  async function connect(token: string) {
    const socket = client(origin, { auth: { token }, transports: ['websocket'], reconnection: false });
    sockets.push(socket);
    await new Promise<void>((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject); });
    return socket;
  }
  try {
    await prisma.user.createMany({ data: ids.map((id, index) => ({
      id, email: `${id}@messaging-test.invalid`, spotifyUserId: `test-${id}`, displayName: ['Test Alice', 'Test Bob', 'Test Eve'][index]
    })) });
    await prisma.follow.createMany({ data: [
      { followerId: ids[0], followingId: ids[1] }, { followerId: ids[1], followingId: ids[0] }
    ] });

    await t.test('unauthenticated REST, missing socket tokens, expired tokens, and non-mutual starts are rejected', async () => {
      assert.equal((await request(null)).status, 401);
      await assert.rejects(connect(''));
      await assert.rejects(connect(jwt.sign({ userId: ids[0] }, env.JWT_SECRET, { expiresIn: -1 })));
      assert.equal((await request(0, '', { targetUserId: ids[0] })).status, 400);
      assert.equal((await request(0, '', { targetUserId: ids[2] })).status, 403);
    });
    const [started, concurrent] = await Promise.all([
      request(0, '', { targetUserId: ids[1] }), request(1, '', { targetUserId: ids[0] })
    ]);
    assert.equal(started.status, 201);
    assert.equal(concurrent.status, 201);
    const conversationId = started.data.conversation.id;
    assert.equal(concurrent.data.conversation.id, conversationId);
    const reversed = await request(1, '', { targetUserId: ids[0] });
    assert.equal(reversed.data.conversation.id, conversationId);
    assert.equal(Object.hasOwn(started.data.conversation.otherUser, 'email'), false);
    assert.equal(Object.hasOwn(started.data.conversation.otherUser, 'spotifyAccessToken'), false);
    const alice = await connect(tokens[0]); const bob = await connect(tokens[1]); const eve = await connect(tokens[2]);
    const bobEvents: any[] = []; const eveEvents: any[] = [];
    bob.on('message:new', (message) => bobEvents.push(message));
    eve.on('message:new', (message) => eveEvents.push(message));
    eve.emit('join', `user:${ids[1]}`);
    const clientMessageId = randomUUID();
    const first = await request(0, `/${conversationId}/messages`, { body: 'Hello Bob', clientMessageId });
    assert.equal(first.status, 201);
    await delay(50);

    await t.test('messages persist before private delivery, retries deduplicate, and outsiders cannot join/read', async () => {
      assert.equal(bobEvents.length, 1);
      assert.equal(bobEvents[0].body, 'Hello Bob');
      assert.ok(await prisma.message.findUnique({ where: { id: bobEvents[0].id } }));
      assert.equal(eveEvents.length, 0);
      assert.equal((await request(2, `/${conversationId}`)).status, 404);
      assert.equal((await request(2, `/${conversationId}/messages`)).status, 404);
      assert.equal((await request(2, `/${conversationId}/messages`, { body: 'Intrusion', clientMessageId: randomUUID() })).status, 404);
      assert.equal((await request(2, `/${conversationId}/read`, { throughMessageId: first.data.message.id })).status, 404);
      const duplicate = await request(0, `/${conversationId}/messages`, { body: 'Hello Bob', clientMessageId });
      assert.equal(duplicate.data.message.id, first.data.message.id);
      assert.equal((await request(0, `/${conversationId}/messages`, { body: 'Changed payload', clientMessageId })).status, 409);
      assert.equal(await prisma.message.count({ where: { conversationId } }), 1);
    });

    await t.test('blank, oversized, and sender-spoofing payloads are rejected', async () => {
      for (const body of ['   ', 'x'.repeat(2001)]) {
        assert.equal((await request(0, `/${conversationId}/messages`, { body, clientMessageId: randomUUID() })).status, 400);
      }
      assert.equal((await request(0, `/${conversationId}/messages`, { body: 'Spoof', clientMessageId: randomUUID(), senderId: ids[1] })).status, 400);
    });

    await t.test('read acknowledgments cannot mark later messages read and unread counts are per recipient', async () => {
      const second = await request(0, `/${conversationId}/messages`, { body: 'Second message', clientMessageId: randomUUID() });
      assert.equal((await request(1)).data.unreadTotal, 2);
      assert.equal((await request(0)).data.unreadTotal, 0);
      assert.equal((await request(1, `/${conversationId}/read`, { throughMessageId: first.data.message.id })).status, 200);
      assert.equal((await request(1)).data.unreadTotal, 1);
      assert.equal((await prisma.message.findUnique({ where: { id: second.data.message.id } }))?.readAt, null);
      assert.equal((await request(1, `/${conversationId}/read`, { throughMessageId: 2_147_483_647 })).status, 400);
      await request(1, `/${conversationId}/read`, { throughMessageId: second.data.message.id });
      assert.equal((await request(1)).data.unreadTotal, 0);
    });

    await t.test('offline messages remain available and paginated history is ordered without overlap', async () => {
      bob.disconnect();
      await request(0, `/${conversationId}/messages`, { body: 'Delivered while offline', clientMessageId: randomUUID() });
      await prisma.message.createMany({ data: Array.from({ length: 55 }, (_, index) => ({
        conversationId, senderId: ids[0], clientMessageId: randomUUID(), body: `History item ${index}`
      })) });
      const latest = await request(1, `/${conversationId}/messages`);
      const older = await request(1, `/${conversationId}/messages?before=${latest.data.nextCursor}`);
      const combined = [...older.data.messages, ...latest.data.messages];
      assert.equal(latest.data.messages.length, 50);
      assert.equal(combined.length, 58);
      assert.equal(new Set(combined.map((message) => message.id)).size, 58);
      assert.deepEqual(combined.map((message) => message.id), combined.map((message) => message.id).sort((a, b) => a - b));
      assert.ok(combined.some((message) => message.body === 'Delivered while offline'));
      assert.ok((await request(1)).data.unreadTotal > 0);
      await connect(tokens[1]);
    });

    await t.test('unfollowing pauses sends without hiding history', async () => {
      await prisma.follow.delete({ where: { followerId_followingId: { followerId: ids[0], followingId: ids[1] } } });
      assert.equal((await request(0, `/${conversationId}/messages`, { body: 'Should not send', clientMessageId: randomUUID() })).status, 403);
      assert.equal((await request(0, `/${conversationId}`)).data.conversation.canSend, false);
      assert.equal((await request(0, `/${conversationId}/messages`)).status, 200);
    });

    await t.test('the per-user write limit returns 429 and a retry header', async () => {
      let limited = false;
      for (let i = 0; i < 31; i++) {
        const response = await request(0, '', { targetUserId: ids[2] });
        if (response.status === 429) { limited = true; assert.equal(response.headers.get('retry-after'), '60'); break; }
      }
      assert.equal(limited, true);
    });

    await t.test('connected sockets are disconnected when their JWT expires', async () => {
      const socket = await connect(jwt.sign({ userId: ids[0] }, env.JWT_SECRET, { expiresIn: 2 }));
      const reason = await new Promise<string>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Expired socket remained connected')), 3500);
        socket.once('disconnect', (reason) => { clearTimeout(timeout); resolve(reason); });
      });
      assert.equal(reason, 'io server disconnect');
    });
    alice.disconnect();
  } finally {
    for (const socket of sockets) socket.disconnect();
    await new Promise<void>((resolve) => io.close(() => resolve()));
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
    await prisma.$disconnect();
  }
});

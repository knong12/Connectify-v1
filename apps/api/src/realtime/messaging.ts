import type { Server as HttpServer } from 'node:http';
import jwt from 'jsonwebtoken';
import { Server } from 'socket.io';
import { env } from '../config/env.js';
import { prisma } from '../lib/prisma.js';

export function createMessagingServer(httpServer: HttpServer) {
  const origins = [new URL(env.CLIENT_URL).origin];
  if (process.env.NODE_ENV !== 'production') origins.push('http://localhost:5173', 'http://127.0.0.1:5173');
  const io = new Server(httpServer, {
    cors: { origin: origins }, maxHttpBufferSize: 8192,
    allowRequest: (request, callback) => callback(null, !request.headers.origin || origins.includes(request.headers.origin))
  });
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth.token;
      if (typeof token !== 'string') throw new Error('Missing token');
      const payload = jwt.verify(token, env.JWT_SECRET, { algorithms: ['HS256'] });
      if (typeof payload === 'string' || typeof payload.userId !== 'string' || typeof payload.exp !== 'number') throw new Error('Invalid token');
      if (!await prisma.user.findUnique({ where: { id: payload.userId }, select: { id: true } })) throw new Error('Unknown user');
      socket.data.userId = payload.userId;
      socket.data.expiresAt = payload.exp * 1000;
      next();
    } catch { next(new Error('Please sign in again.')); }
  });
  io.on('connection', (socket) => {
    // Only the server chooses private user rooms. There is no client-controlled join event.
    socket.join(`user:${socket.data.userId}`);
    const timer = setTimeout(() => socket.disconnect(true), Math.max(0, Math.min(socket.data.expiresAt - Date.now(), 2_147_483_647)));
    timer.unref();
    socket.on('disconnect', () => clearTimeout(timer));
  });
  return io;
}

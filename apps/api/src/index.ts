import cors from 'cors';
import express from 'express';
import { createServer } from 'node:http';
import { createMessagingServer } from './realtime/messaging.js';
import { createConversationRoutes } from './routes/conversations.js';
import { env } from './config/env.js';
import authRoutes from './routes/auth.js';
import followRoutes from './routes/follows.js';
import healthRoutes from './routes/health.js';
import matchesRoutes from './routes/matches.js';
import meRoutes from './routes/me.js';
import usersRoutes from './routes/users.js';
import mixRoutes from './routes/mixes.js';

const app = express();
const server = createServer(app);
const messaging = createMessagingServer(server);

app.use(
  cors({
    origin: env.CLIENT_URL,
    credentials: true
  })
);
app.use(express.json());

app.use('/health', healthRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/follows', followRoutes);
app.use('/api/me', meRoutes);
app.use('/api/matches', matchesRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/mixes', mixRoutes);
app.use('/api/conversations', createConversationRoutes((users, event, payload) => {
  messaging.to(users.map((id) => `user:${id}`)).emit(event, payload);
}));

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  res.status(500).json({
    message: 'Unhandled server error.',
    error: error instanceof Error ? error.message : 'Unknown error'
  });
});

server.listen(env.PORT, () => {
  console.log(`connectify-api listening on http://127.0.0.1:${env.PORT}`);
});

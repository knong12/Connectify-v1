import cors from 'cors';
import express from 'express';
import { env } from './config/env.js';
import authRoutes from './routes/auth.js';
import followRoutes from './routes/follows.js';
import healthRoutes from './routes/health.js';
import matchesRoutes from './routes/matches.js';
import meRoutes from './routes/me.js';

const app = express();

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

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  res.status(500).json({
    message: 'Unhandled server error.',
    error: error instanceof Error ? error.message : 'Unknown error'
  });
});

app.listen(env.PORT, () => {
  console.log(`connectify-api listening on http://127.0.0.1:${env.PORT}`);
});

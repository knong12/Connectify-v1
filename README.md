# Connectify v1



1. A user signs in with Spotify.
2. Sync their top music data into Postgres.
3. Show a simple matches list.



- `apps/api` owns Spotify auth, persistence, and matching
- `apps/web` is a thin UI over stable API routes
- env values are the only place ports and URLs are configured

## Proposed milestone order

1. Health route and config validation
2. Prisma schema and migrations
3. Spotify OAuth start + callback
4. Sync profile, top artists, top tracks, and genres
5. Basic match score endpoint
6. Thin frontend for login, profile, and matches

## Project structure

```text
Connectify-v2/
  apps/
    api/    # Express + TypeScript + Prisma
    web/    # React + Vite + TypeScript
```

## Local setup

Install these first on your machine:

- Node.js LTS
- npm
- PostgreSQL

Then:

```bash
cd Connectify-v2
npm install
cd apps/api
cp .env.example .env
npx prisma migrate dev
npm run dev

cd ../web
cp .env.example .env
npm run dev
```

## Environment

### API

Copy [`apps/api/.env.example`](C:\Users\kevin\Documents\Codex\2026-04-18-hi\Connectify-v2\apps\api\.env.example) to `.env` and fill in:

- `DATABASE_URL`
- `JWT_SECRET`
- `CLIENT_URL`
- `SPOTIFY_CLIENT_ID`
- `SPOTIFY_CLIENT_SECRET`
- `SPOTIFY_REDIRECT_URI`
- `PORT`

### Web

Copy [`apps/web/.env.example`](C:\Users\kevin\Documents\Codex\2026-04-18-hi\Connectify-v2\apps\web\.env.example) to `.env` and fill in:

- `VITE_API_URL`

## Recommended defaults

- API: `http://127.0.0.1:5001`
- Web: `http://127.0.0.1:5173`
- Spotify redirect URI: `http://127.0.0.1:5001/api/auth/spotify/callback`

## Step-By-Step Build Order

Follow this order and keep each step working before moving on:

1. `apps/api/src/services/authService.ts`
   Replace the placeholder auth state with a real random state value and decide
   how you want to store and validate it.
2. `apps/api/src/services/spotifyService.ts`
   Implement `exchangeCodeForTokens()`.
3. `apps/api/src/services/spotifyService.ts`
   Implement `fetchSpotifyProfile()`.
4. `apps/api/src/routes/auth.ts`
   Test the full callback route until it returns a saved user and `appToken`.
5. `apps/api/src/services/spotifyService.ts`
   Implement `syncTopMusicData()`.
6. `apps/api/src/services/authService.ts`
   Uncomment the sync call inside `finishSpotifyLogin()`.
7. `apps/api/src/routes/me.ts`
   Shape the `/api/me` response for the frontend.
8. `apps/api/src/services/matchService.ts`
   Replace the placeholder match function with a simple overlap-based score.
9. `apps/web/src/pages/HomePage.tsx`
   Change the login action from a plain link into the real browser redirect
   experience you want.
10. `apps/web/src/pages/ProfilePage.tsx` and `apps/web/src/pages/MatchesPage.tsx`
    Fetch and render live API data.

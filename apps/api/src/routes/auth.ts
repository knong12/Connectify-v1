import { Router } from 'express';
import { env } from '../config/env.js';
import { NotImplementedError } from '../lib/errors.js';
import {
  createSpotifyAuthState,
  finishSpotifyLogin
} from '../services/authService.js';
import {
  buildSpotifyAuthorizeUrl,
  exchangeCodeForTokens,
  fetchSpotifyProfile
} from '../services/spotifyService.js';

const router = Router();

router.get('/spotify', (_req, res) => {
  const state = createSpotifyAuthState();
  const authUrl = buildSpotifyAuthorizeUrl(state);

  res.json({
    message: 'Step 2: open this URL to start Spotify auth.',
    nextStep: 'After Spotify redirects back, implement the callback route flow.',
    url: authUrl.toString()
  });
});

router.get('/spotify/callback', async (req, res) => {
  const code = typeof req.query.code === 'string' ? req.query.code : null;
  const error = typeof req.query.error === 'string' ? req.query.error : null;

  if (error) {
    res.status(400).json({
      message: 'Spotify returned an error.',
      error
    });
    return;
  }

  if (!code) {
    res.status(400).json({
      message: 'Missing Spotify authorization code.'
    });
    return;
  }

  try {
    // Step 3:
    // Implement each function below in order. The route already shows the
    // end-to-end orchestration you are aiming for.
    const tokens = await exchangeCodeForTokens(code);
    const profile = await fetchSpotifyProfile(tokens.access_token);
    const { appToken, user } = await finishSpotifyLogin(profile, tokens);

    res.json({
      message: 'Spotify login flow completed.',
      nextStep: 'Redirect this result back to the frontend and store appToken.',
      appToken,
      user
    });
  } catch (error) {
    if (error instanceof NotImplementedError) {
      res.status(501).json({
        message: error.message,
        stepGuide: [
          'Step 3: Exchange the callback code for Spotify tokens.',
          'Step 4: Fetch the Spotify profile.',
          'Step 5: Upsert the user in Postgres.',
          'Step 6: Sync top music data.',
          'Step 7: Return or redirect with the app JWT.'
        ]
      });
      return;
    }

    res.status(500).json({
      message: 'Unexpected error during Spotify callback.',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

export default router;

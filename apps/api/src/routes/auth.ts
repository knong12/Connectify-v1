import { Router } from 'express';
import { env } from '../config/env.js';
import { consumeSpotifyAuthState, oauthStateLifetimeMs } from '../services/oauthState.js';
import {
  createSpotifyAuthState,
  finishSpotifyLogin
} from '../services/authService.js';
import {
  buildSpotifyAuthorizeUrl,
  exchangeCodeForTokens,
  fetchSpotifyProfile,
  getSpotifyFailure
} from '../services/spotifyService.js';

const router = Router();
const stateCookie = 'connectify_oauth_state';
const cookieOptions = {
  httpOnly: true,
  secure: new URL(env.SPOTIFY_REDIRECT_URI).protocol === 'https:',
  sameSite: 'lax' as const,
  path: '/api/auth'
};

function failureUrl(code: string) {
  const url = new URL('/', env.CLIENT_URL);
  url.searchParams.set('authError', code);
  return url.toString();
}

router.get('/spotify', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  try {
    const state = createSpotifyAuthState();
    res.cookie(stateCookie, state, { ...cookieOptions, maxAge: oauthStateLifetimeMs });
    res.redirect(buildSpotifyAuthorizeUrl(state));
  } catch {
    res.redirect(failureUrl('unavailable'));
  }
});

router.get('/spotify/callback', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.set('Referrer-Policy', 'no-referrer');
  const cookies = (req.headers.cookie ?? '').split(';').map((cookie) => cookie.trim());
  const cookieState = cookies.find((cookie) => cookie.startsWith(`${stateCookie}=`))?.slice(stateCookie.length + 1);
  res.clearCookie(stateCookie, cookieOptions);
  if (!consumeSpotifyAuthState(req.query.state, cookieState)) {
    res.redirect(failureUrl('invalid_state'));
    return;
  }
  const code = typeof req.query.code === 'string' ? req.query.code : null;
  const error = typeof req.query.error === 'string' ? req.query.error : null;

  if (error) {
    res.redirect(failureUrl(error === 'access_denied' ? 'cancelled' : 'login_failed'));
    return;
  }

  if (!code) {
    res.redirect(failureUrl('missing_code'));
    return;
  }

  try {
    const tokens = await exchangeCodeForTokens(code);
    const profile = await fetchSpotifyProfile(tokens.access_token);
    const { appToken, user } = await finishSpotifyLogin(profile, tokens);
    const redirectUrl = new URL('/profile', env.CLIENT_URL);
    redirectUrl.searchParams.set('token', appToken);
    redirectUrl.searchParams.set('userId', user.id);

    res.redirect(redirectUrl.toString());
  } catch (error) {
    const failure = getSpotifyFailure(error);
    console.warn('Spotify login failed.', { code: failure.code, status: failure.status });
    res.redirect(failureUrl(failure.code));
  }
});

export default router;

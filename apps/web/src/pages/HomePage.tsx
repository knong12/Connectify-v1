import { getApiUrl } from '../lib/api';
import { useSearchParams } from 'react-router-dom';

const apiUrl = getApiUrl();


//various auth messages based on the state
const authMessages: Record<string, string> = {
  invalid_state: 'Your login attempt expired or could not be verified. Please start Spotify login again.',
  cancelled: 'Spotify login was cancelled. You can try again when you are ready.',
  missing_code: 'Spotify did not complete the login. Please try again.',
  reconnect: 'Your Spotify authorization expired. Please sign in again.',
  rate_limited: 'Spotify is receiving too many requests. Please wait a while before trying again.',
  access_denied: 'Spotify denied access. Check that your account is allowed to use this app.',
  unavailable: 'Could not reach Spotify. Please try again shortly.',
  login_failed: 'Could not complete login or music synchronization. Please try again.'
};

export default function HomePage() {
  const [searchParams] = useSearchParams();
  const authError = searchParams.get('authError');
  const authMessage = authError && Object.prototype.hasOwnProperty.call(authMessages, authError)
    ? authMessages[authError]
    : authMessages.login_failed;
  return (
    <div className="stack">
      {authError ? <p role="alert">{authMessage}</p> : null}
      <section className="hero home-hero">
        <div className="home-hero-copy">
          <p className="eyebrow">Connect Through Music</p>
          <h2>Find people who have similar music taste</h2>
          <p className="home-lead">
            Connectify uses your Spotify taste to build a music profile, surface potential matches,
            and help you discover people with a similar vibe.
          </p>
          <a className="button home-cta" href={`${apiUrl}/api/auth/spotify`}>
            Login with Spotify
          </a>
        </div>
        <div className="home-hero-card">
          <p className="eyebrow">What You Get</p>
          <h3>Your music identity</h3>
          <p className="muted">
            Sync your top artists and tracks, compare taste, and
            explore profiles that feel close to your listening style.
          </p>
          <div className="pill-row">
            <span className="pill">Top Artists</span>
            <span className="pill">Top Tracks</span>
            <span className="pill">Profile Matches</span>
          </div>
        </div>
      </section>
    </div>
  );
}

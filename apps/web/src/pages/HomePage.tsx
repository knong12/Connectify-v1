import { getApiUrl } from '../lib/api';

const apiUrl = getApiUrl();

export default function HomePage() {
  return (
    <div className="stack">
      <section className="hero home-hero">
        <div className="home-hero-copy">
          <p className="eyebrow">Connect Through Music</p>
          <h2>Find people who actually listen like you.</h2>
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
          <h3>Your music identity in one place</h3>
          <p className="muted">
            Sync your top artists and tracks, compare taste across different time ranges, and
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

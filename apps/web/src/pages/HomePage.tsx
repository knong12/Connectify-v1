import ApiCard from '../components/ApiCard';
import { getApiUrl } from '../lib/api';

const apiUrl = getApiUrl();

export default function HomePage() {
  return (
    <div className="stack">
      <section className="hero">
        <p className="eyebrow">Milestone 1</p>
        <h2>Log in with Spotify, sync taste data, show a simple match list.</h2>
        <p>
          This restart strips the product back to one flow we can make robust
          before adding recommendations, polish, or extra API layers.
        </p>
        <p>
          Right now the strongest demo path is Spotify login, saved top artists,
          saved top tracks, and a profile page that proves the sync worked.
        </p>
        <a className="button" href={`${apiUrl}/api/auth/spotify`}>
          Start Spotify Auth
        </a>
      </section>
      <ApiCard />
    </div>
  );
}

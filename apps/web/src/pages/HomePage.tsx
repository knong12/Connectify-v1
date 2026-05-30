import ApiCard from '../components/ApiCard';
import { getApiUrl } from '../lib/api';

const apiUrl = getApiUrl();

export default function HomePage() {
  return (
    <div className="stack">
      <section className="hero">
        <p className="eyebrow">Milestone 1</p>
        <h2>Log in with Spotify, sync taste data, find a match.</h2>
        <p>
          Test.
        </p>
        <p>
          currently it shows, saved top artists,
          saved top tracks, and a profile page.
        </p>
        <a className="button" href={`${apiUrl}/api/auth/spotify`}>
          Start Spotify Auth
        </a>
      </section>
      <ApiCard />
    </div>
  );
}

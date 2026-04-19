import ApiCard from '../components/ApiCard';

const apiUrl = import.meta.env.VITE_API_URL || 'http://127.0.0.1:5001';

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
        <a className="button" href={`${apiUrl}/api/auth/spotify`}>
          Start Spotify Auth
        </a>
      </section>
      <ApiCard />
    </div>
  );
}


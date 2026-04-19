const apiUrl = import.meta.env.VITE_API_URL || 'http://127.0.0.1:5001';

export default function ApiCard() {
  return (
    <section className="card">
      <h2>API Contract</h2>
      <p>
        The web app only talks to the backend through an environment variable,
        so we never hardcode ports into app logic again.
      </p>
      <code>{apiUrl}</code>
    </section>
  );
}


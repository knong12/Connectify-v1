import { NavLink, Route, Routes } from 'react-router-dom';
import HomePage from './pages/HomePage';
import MatchesPage from './pages/MatchesPage';
import ProfilePage from './pages/ProfilePage';

export default function App() {
  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <h1>Connectify</h1>
        </div>
        <nav className="nav">
          <NavLink to="/">Home</NavLink>
          <NavLink to="/profile">Profile</NavLink>
          <NavLink to="/matches">Matches</NavLink>
        </nav>
      </header>
      <main className="page">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/profile/:userId" element={<ProfilePage />} />
          <Route path="/matches" element={<MatchesPage />} />
        </Routes>
      </main>
    </div>
  );
}

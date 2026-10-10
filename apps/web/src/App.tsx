import { useEffect, useState } from 'react';
import { NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import HomePage from './pages/HomePage';
import MatchesPage from './pages/MatchesPage';
import ProfilePage from './pages/ProfilePage';

export default function App() {
  const location = useLocation();
  const navigate = useNavigate();
  const [isSignedIn, setIsSignedIn] = useState(() =>
    Boolean(localStorage.getItem('connectify_app_token'))
  );

  useEffect(() => {
    setIsSignedIn(Boolean(localStorage.getItem('connectify_app_token')));
  }, [location.pathname, location.search]);

  useEffect(() => {
    function handleStorageChange(event: StorageEvent) {
      if (event.key !== 'connectify_app_token' && event.key !== null) {
        return;
      }

      const signedIn = Boolean(localStorage.getItem('connectify_app_token'));
      setIsSignedIn(signedIn);
      if (!signedIn) {
        navigate('/', { replace: true });
      }
    }

    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, [navigate]);

  function handleLogout() {
    localStorage.removeItem('connectify_app_token');
    setIsSignedIn(false);
    navigate('/', { replace: true });
  }

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
          {isSignedIn ? (
            <button className="logout-button" onClick={handleLogout} type="button">
              Log out
            </button>
          ) : null}
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

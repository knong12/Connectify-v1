import { useEffect, useState } from 'react';
import { NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import HomePage from './pages/HomePage';
import MatchesPage from './pages/MatchesPage';
import ProfilePage from './pages/ProfilePage';
import EditProfilePage from './pages/EditProfilePage';

const themeStorageKey = 'connectify_theme';

function readThemePreference(): 'light' | 'dark' | null {
  try {
    const value = localStorage.getItem(themeStorageKey);
    return value === 'light' || value === 'dark' ? value : null;
  } catch {
    return null;
  }
}

export default function App() {
  const location = useLocation();
  const navigate = useNavigate();
  const [themePreference, setThemePreference] = useState(readThemePreference);
  const [systemDark, setSystemDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches);
  const theme = themePreference ?? (systemDark ? 'dark' : 'light');

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => setSystemDark(media.matches);
    const onStorage = (event: StorageEvent) => {
      if (event.key === themeStorageKey || event.key === null) setThemePreference(readThemePreference());
    };
    media.addEventListener('change', onChange);
    window.addEventListener('storage', onStorage);
    return () => {
      media.removeEventListener('change', onChange);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  function toggleTheme() {
    const next = theme === 'dark' ? 'light' : 'dark';
    setThemePreference(next);
    try {
      localStorage.setItem(themeStorageKey, next);
    } catch {
      // Theme switching still works when browser storage is unavailable.
    }
  }
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
          <button
            className="theme-toggle"
            type="button"
            role="switch"
            aria-checked={theme === 'dark'}
            onClick={toggleTheme}
            title="Toggle dark mode"
          >
            <span className="theme-switch-track" aria-hidden="true"><span /></span>
            Dark mode
          </button>
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
          <Route path="/profile/edit" element={<EditProfilePage />} />
          <Route path="/profile/:userId" element={<ProfilePage />} />
          <Route path="/matches" element={<MatchesPage />} />
        </Routes>
      </main>
    </div>
  );
}

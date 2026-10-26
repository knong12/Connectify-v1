import { useEffect, useState } from 'react';

//Import routing tools for navigation and rendering
import { NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom';


//Import application pages
import HomePage from './pages/HomePage';
import MatchesPage from './pages/MatchesPage';
import MixPage from './pages/MixPage';
import ProfilePage from './pages/ProfilePage';
import EditProfilePage from './pages/EditProfilePage';
import MessagesPage from './pages/MessagesPage';

//Import shared messaging and messaging navigation link
import { MessagingProvider, MessagesNavLink } from './components/MessagingProvider';

//key saved for users theme (light or dark)
const themeStorageKey = 'connectify_theme';

//Reads saved theme, Returns light, dark or null if invalid
function readThemePreference(): 'light' | 'dark' | null {
  try {
    const value = localStorage.getItem(themeStorageKey); //getItem to retrieve theme
    return value === 'light' || value === 'dark' ? value : null;
  } catch {
    return null;
  }
}

// Main component for app layout, navigation, theme and routes
export default function App() {
  //Read current URL (location) and function for navigating pages
  const location = useLocation();
  const navigate = useNavigate();

  //Load theme preference
  const [themePreference, setThemePreference] = useState(readThemePreference);
  const [systemDark, setSystemDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches);
  //use saved preference, otherwise follow system theme as default
  const theme = themePreference ?? (systemDark ? 'dark' : 'light');

  //HTML element's data theme so CSS can also copy theme
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  //listen of system theme changes, if so change all other pages 
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

  //toggles between light and dark
  function toggleTheme() {
    const next = theme === 'dark' ? 'light' : 'dark';
    setThemePreference(next);
    try {
      localStorage.setItem(themeStorageKey, next); //save theme on local database
    }catch{
      
    }
  }


  //Token validation and store
  const [isSignedIn, setIsSignedIn] = useState(() =>
    Boolean(localStorage.getItem('connectify_app_token'))
  );

  //fetch and recheck token
  useEffect(() => {
    setIsSignedIn(Boolean(localStorage.getItem('connectify_app_token')));
  }, [location.pathname, location.search]);

  //Keep sign in state synced when pages change
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

  //Handling logout, remove local app token, update and refresh UI and redirect to home page
  function handleLogout() {
    localStorage.removeItem('connectify_app_token'); //token removal
    setIsSignedIn(false); //logout
    navigate('/', { replace: true }); //renavigate
  }
//Display current UI 
  return (
    <MessagingProvider token={isSignedIn ? localStorage.getItem('connectify_app_token') : null}>
    <div className="app-shell">
      <header className="topbar">
        <div>
          <h1>Connectify</h1>
        </div>
        <nav className="nav">
          <NavLink to="/">Home</NavLink>
          <NavLink to="/profile">Profile</NavLink>
          <NavLink to="/matches">Matches</NavLink>
          {isSignedIn && <MessagesNavLink />}
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
          <Route path="/mix/:userId" element={<MixPage />} />
          <Route path="/messages" element={<MessagesPage />} />
          <Route path="/messages/:conversationId" element={<MessagesPage />} />
        </Routes>
      </main>
    </div>
    </MessagingProvider>
  );
}

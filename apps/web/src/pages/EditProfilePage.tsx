import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, Save } from 'lucide-react';
import { fetchProfile, updateProfile, type ProfileResponse } from '../lib/api';

type ProfileForm = { bio: string; favoriteArtistNote: string; musicPrompt: string };
type LoadState = { status: 'loading' } | { status: 'error' } |
  { status: 'ready'; profile: ProfileResponse['user']; original: ProfileForm };

export default function EditProfilePage() {
  const navigate = useNavigate();
  const mounted = useRef(false);
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [form, setForm] = useState<ProfileForm>({ bio: '', favoriteArtistNote: '', musicPrompt: '' });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const dirty = state.status === 'ready' && (Object.keys(form) as (keyof ProfileForm)[])
    .some((key) => form[key] !== state.original[key]);

  useEffect(() => {
    mounted.current = true;
    let cancelled = false;
    const token = localStorage.getItem('connectify_app_token');
    if (!token) setState({ status: 'error' });
    else fetchProfile(token).then(({ user }) => {
      if (cancelled) return;
      const initial = { bio: user.bio ?? '', favoriteArtistNote: user.favoriteArtistNote ?? '', musicPrompt: user.musicPrompt ?? '' };
      setForm(initial);
      setState({ status: 'ready', profile: user, original: initial });
    }).catch(() => { if (!cancelled) setState({ status: 'error' }); });
    return () => { cancelled = true; mounted.current = false; };
  }, []);

  useEffect(() => {
    if (!dirty) return;
    const warnOnUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warnOnUnload);
    return () => window.removeEventListener('beforeunload', warnOnUnload);
  }, [dirty]);

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving || !dirty) return;
    const token = localStorage.getItem('connectify_app_token');
    if (!token) { setSaveError('Your session ended. Please sign in again.'); return; }
    setSaving(true);
    setSaveError('');
    try {
      await updateProfile(token, form);
      if (mounted.current && localStorage.getItem('connectify_app_token') === token) {
        navigate('/profile', { replace: true, state: { profileSaved: true } });
      }
    } catch {
      if (mounted.current) setSaveError('Could not save your profile. Your changes are still here; please try again.');
    } finally {
      if (mounted.current) setSaving(false);
    }
  }

  return (
    <div className="profile-editor">
      <Link className="profile-back-button" to="/profile" aria-disabled={saving}
        onClick={(event) => {
          if (saving || (dirty && !window.confirm('Discard your unsaved profile changes?'))) event.preventDefault();
        }}><ArrowLeft size={16} aria-hidden="true" />Back to profile</Link>
      <header className="profile-editor-header">
        <p className="eyebrow">Your profile</p>
        <h2>Edit profile</h2>
        {state.status === 'ready' && <p className="muted">{state.profile.displayName}</p>}
      </header>
      {state.status === 'loading' && <p role="status">Loading your profile...</p>}
      {state.status === 'error' && <p role="alert">Could not load your profile. <Link to="/">Sign in again</Link> or try refreshing.</p>}
      {state.status === 'ready' && (
        <form className="profile-form profile-editor-form" onSubmit={saveProfile} aria-busy={saving}>
          <fieldset disabled={saving}>
            <legend className="profile-editor-legend">Personal details</legend>
            <label className="field">
              <span className="profile-editor-label"><span className="field-label">Short bio</span><span className="profile-field-count" aria-hidden="true">{form.bio.length}/240</span></span>
              <textarea maxLength={240} rows={4} value={form.bio}
                onChange={(event) => setForm((current) => ({ ...current, bio: event.target.value }))} />
            </label>
            <label className="field">
              <span className="profile-editor-label"><span className="field-label">Favorite artist highlight</span><span className="profile-field-count" aria-hidden="true">{form.favoriteArtistNote.length}/120</span></span>
              <input maxLength={120} type="text" value={form.favoriteArtistNote}
                onChange={(event) => setForm((current) => ({ ...current, favoriteArtistNote: event.target.value }))} />
            </label>
            <label className="field">
              <span className="profile-editor-label"><span className="field-label">Music prompt</span><span className="profile-field-count" aria-hidden="true">{form.musicPrompt.length}/180</span></span>
              <input maxLength={180} type="text" value={form.musicPrompt}
                onChange={(event) => setForm((current) => ({ ...current, musicPrompt: event.target.value }))} />
            </label>
          </fieldset>
          {saveError && <p role="alert" className="profile-editor-error">{saveError}</p>}
          <div className="profile-editor-footer">
            <button className="button button-ghost" type="button" disabled={saving} onClick={() => {
              if (!dirty || window.confirm('Discard your unsaved profile changes?')) navigate('/profile');
            }}>Cancel</button>
            <button className="button" type="submit" disabled={saving || !dirty}><Save size={16} aria-hidden="true" />{saving ? 'Saving...' : 'Save changes'}</button>
          </div>
        </form>
      )}
    </div>
  );
}

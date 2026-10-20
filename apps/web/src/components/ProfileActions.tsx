import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, Pencil } from 'lucide-react';

export default function ProfileActions() {
  const dropdown = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    function closeOutside(event: PointerEvent) {
      if (event.target instanceof Node && !dropdown.current?.contains(event.target)) {
        dropdown.current?.removeAttribute('open');
      }
    }
    document.addEventListener('pointerdown', closeOutside);
    return () => document.removeEventListener('pointerdown', closeOutside);
  }, []);

  return (
    <details className="profile-actions-dropdown" ref={dropdown}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          dropdown.current?.removeAttribute('open');
          dropdown.current?.querySelector('summary')?.focus();
        }
      }}>
      <summary title="Profile editing options"><Pencil size={16} aria-hidden="true" />Edit<ChevronDown size={16} aria-hidden="true" /></summary>
      <div className="profile-actions-menu">
        <Link to="/profile/edit"><Pencil size={16} aria-hidden="true" />Edit profile</Link>
      </div>
    </details>
  );
}

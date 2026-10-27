
import { useEffect, useState } from "react";
import { Link, useLocation } from 'react-router-dom';
import { playAudio } from './AudioManager';
import { signOut } from 'firebase/auth';
import { auth } from '../Firebase/firebase.utils';
import { disableAdminPush } from '../Firebase/push';
import "./layout.css";
import { stopAllAudio } from "./AudioManager";

const ResponsiveLayout = ({ children }) => {
  const location = useLocation();
  const [muted, setMuted] = useState(localStorage.getItem('afubiaVoiceMuted') === 'yes');
  const isAdminPage = location.pathname.startsWith('/admin');

  useEffect(() => {

    // Stop all audio when leaving the page
    return () => {
      stopAllAudio();
    };

  }, []);

  return (
    <div className="layout">

      <header className="layout-header">

        <div className="header-content">

          <div className="brand-mark">
            AF
          </div>

          <div className="brand-text">

            <h1>
              Afubia Farms
            </h1>

            <span>
              Palm Oil Sales
            </span>

          </div>

        </div>

      </header>


      <a className="skip-link" href="#main-content">Skip to content</a>
      {isAdminPage ? <nav className="workspace-nav" aria-label="Administration">
        {[['/admin', 'Overview'], ['/admin/shop-stock', 'Shop stock'], ['/admin/products', 'Products'], ['/admin/materials', 'Materials'], ['/admin/reports', 'Reports'], ['/admin/profit', 'Profit'], ['/admin/stock', 'Packaging']].map(([path, label]) => <Link key={path} to={path} aria-current={location.pathname === path ? 'page' : undefined}>{label}</Link>)}
        <button type="button" className="workspace-signout" onClick={async () => { try { if (localStorage.getItem('afubiaPushTokenId')) await disableAdminPush(); await signOut(auth); window.location.assign('/login'); } catch { window.alert('Could not sign out safely. Check your connection and try again.'); } }}>Sign out</button>
      </nav> : location.pathname !== '/login' && <div className="voice-toolbar"><Link to="/dashboard">← Work dashboard</Link><div><button type="button" onClick={() => { localStorage.setItem('afubiaVoiceMuted', 'no'); setMuted(false); void playAudio(location.pathname === '/conversion' ? 'turn_oil' : location.pathname === '/sales' ? 'sellpage' : 'dashboard'); }}>Listen to guidance</button><button type="button" aria-pressed={muted} onClick={() => { const next = !muted; setMuted(next); localStorage.setItem('afubiaVoiceMuted', next ? 'yes' : 'no'); stopAllAudio(); }}>{muted ? 'Voice off' : 'Mute voice'}</button></div></div>}
      <main className="layout-main" id="main-content">

        <div className="layout-card">
          {children}
        </div>

      </main>


      <footer className="layout-footer">

        <span>
          © 2026 Afubia Farms
        </span>

        <span>
          •
        </span>

        <span>
          Palm Oil Sales System
        </span>

      </footer>

    </div>
  );
};

export default ResponsiveLayout;

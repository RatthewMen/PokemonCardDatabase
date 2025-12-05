import React, { useEffect, useMemo, useState } from 'react';
import './styles.css';
import Home from './pages/Home.jsx';
import Statistics from './pages/Statistics.jsx';
import Database from './pages/Database.jsx';
import Logs from './pages/Logs.jsx';
import SignIn from './pages/SignIn.jsx';
import { useAuth } from './context/AuthContext.jsx';

function App() {
  const [hash, setHash] = useState(() => window.location.hash || '#home');
  const { user } = useAuth();
  useEffect(() => {
    const onHash = () => setHash(window.location.hash || '#home');
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const page = useMemo(() => {
    switch ((hash || '').toLowerCase()) {
      case '#statistics': return 'statistics';
      case '#database': return 'database';
      case '#logs': return 'logs';
      case '#signin': return 'signin';
      default: return 'home';
    }
  }, [hash]);

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">Pokemon Collection</div>
        <nav className="nav">
          <a href="#home" className={page === 'home' ? 'active' : ''} id="nav-home">Home</a>
          <a href="#statistics" className={page === 'statistics' ? 'active' : ''} id="nav-statistics">Statistics</a>
          <a href="#database" className={page === 'database' ? 'active' : ''} id="nav-database">Database</a>
          <a href="#logs" className={page === 'logs' ? 'active' : ''} id="nav-logs">Logs</a>
          <a href="#signin" className={page === 'signin' ? 'active' : ''} id="nav-signin">Sign In</a>
        </nav>
        <div className="divider"></div>
        <div className="small mono" id="sdkStatus">{user ? 'Signed in' : 'Signed out'}</div>
        <div className="divider"></div>
        <div className="stack">
          <a className="btn secondary" href="#signin" id="signOut">Account</a>
        </div>
        <div className="small mono" id="authStatus">{user ? 'Authenticated' : 'Guest'}</div>
      </aside>
      <main className="content">
        {page === 'home' && (
          <section><h2 className="section-title">Home</h2><Home /></section>
        )}
        {page === 'statistics' && (
          <section><h2 className="section-title">Statistics</h2><Statistics /></section>
        )}
        {page === 'database' && (
          <section><h2 className="section-title">Database</h2><Database /></section>
        )}
        {page === 'logs' && (
          <section><h2 className="section-title">Logs</h2><Logs /></section>
        )}
        {page === 'signin' && (
          <section><h2 className="section-title">Sign In</h2><SignIn /></section>
        )}
      </main>
    </div>
  );
}

export default App;



import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';

export default function SignIn() {
  const { signIn, signUp, user, signOut } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  const handleSignIn = async () => {
    if (!username || !password) return alert('Enter username and password');
    setBusy(true);
    try {
      await signIn(username, password);
      window.location.hash = '#home';
    } catch (e) {
      alert('Sign-in failed: ' + (e && e.message ? e.message : String(e)));
    } finally {
      setBusy(false);
    }
  };

  const handleSignUp = async () => {
    if (!username || !password) return alert('Enter username and password');
    setBusy(true);
    try {
      await signUp(username, password);
      window.location.hash = '#home';
    } catch (e) {
      alert('Sign-up failed: ' + (e && e.message ? e.message : String(e)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card">
      {user ? (
        <div className="stack">
          <div className="small mono">Signed in</div>
          <button className="btn secondary" onClick={() => signOut()}>Sign Out</button>
        </div>
      ) : (
        <>
          <label className="small" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span>Username or Email</span>
            <input value={username} onChange={e => setUsername(e.target.value)} placeholder="yourname or you@example.com" style={{ padding: 8, border: '1px solid #E2E8F0', borderRadius: 8 }} />
          </label>
          <label className="small space-top" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span>Password</span>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" style={{ padding: 8, border: '1px solid #E2E8F0', borderRadius: 8 }} />
          </label>
          <div className="stack space-top">
            <button className="btn" onClick={handleSignIn} disabled={busy}>Sign In</button>
            <button className="btn ghost" onClick={handleSignUp} disabled={busy}>Create Account</button>
          </div>
          <div className="small space-top muted">Use the same username/password for either action.</div>
        </>
      )}
    </div>
  );
}



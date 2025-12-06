import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { firebaseApp } from '../firebase.js';
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut
} from 'firebase/auth';
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  serverTimestamp
} from 'firebase/firestore';

const AuthContext = createContext(null);

function toEmail(input) {
  const clean = String(input || '').trim();
  if (!clean) return '';
  if (clean.includes('@')) return clean.toLowerCase();
  return clean.toLowerCase() + '@example.com';
}

async function fetchClientIp() {
  try {
    const res = await fetch('https://api.ipify.org?format=json');
    const data = await res.json();
    return (data && data.ip) || '';
  } catch {
    return '';
  }
}

export function AuthProvider({ children }) {
  const auth = useMemo(() => getAuth(firebaseApp), []);
  const db = useMemo(() => getFirestore(firebaseApp), []);

  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    return onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (u) {
        try {
          const ref = doc(db, 'Users', u.uid);
          const snap = await getDoc(ref);
          const existing = snap.exists() ? (snap.data() || {}) : {};
          const ip = await fetchClientIp();
          const next = {
            ...existing,
            lastVisit: serverTimestamp(),
            username: existing.username || (u.email ? String(u.email).split('@')[0] : ''),
            ip: ip || existing.ip || ''
          };
          await setDoc(ref, next, { merge: true });
          setProfile(next);
        } catch {
          setProfile(null);
        }
      } else {
        setProfile(null);
      }
      setLoading(false);
    });
  }, [auth, db]);

  const signIn = useCallback(async (username, password) => {
    await signInWithEmailAndPassword(auth, toEmail(username), password);
  }, [auth]);

  const signUp = useCallback(async (username, password) => {
    const raw = String(username || '').trim();
    const email = toEmail(raw);
    const uname = email.split('@')[0];
    if (!email) throw new Error('Enter a username or email.');
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    const ref = doc(db, 'Users', cred.user.uid);
    await setDoc(ref, {
      username: uname,
      ip: await fetchClientIp(),
      lastVisit: serverTimestamp(),
      canEdit: false,
      createdAt: serverTimestamp()
    }, { merge: true });
  }, [auth, db]);

  const signOutAll = useCallback(async () => {
    await signOut(auth);
  }, [auth]);

  const value = useMemo(() => ({
    user,
    profile,
    loading,
    canEdit: !!(profile && profile.canEdit === true),
    signIn,
    signUp,
    signOut: signOutAll
  }), [user, profile, loading, signIn, signUp, signOutAll]);

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}



/**
 * One-time migration: rename CardLogs and SealedLogs docs to alphabetically sortable IDs.
 *
 * - New ID format derives from each doc's `time` field:
 *   e.g. 2025-12-13T20-15-03-123Z-abcd
 * - Content is preserved exactly (no modifications to fields).
 * - Old documents are deleted after the copy succeeds.
 *
 * Usage:
 *   1) Ensure Firebase web config is available either via environment variables:
 *        VITE_FIREBASE_API_KEY, VITE_FIREBASE_AUTH_DOMAIN, VITE_FIREBASE_PROJECT_ID,
 *        VITE_FIREBASE_STORAGE_BUCKET, VITE_FIREBASE_MESSAGING_SENDER_ID, VITE_FIREBASE_APP_ID
 *      or via file: public/config/firebaseConfig.js (window.__FIREBASE_CONFIG__ assignment).
 *   2) Run:
 *        npm run migrate:logs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeApp } from 'firebase/app';
import {
  getFirestore,
  collection,
  doc,
  getDocs,
  writeBatch
} from 'firebase/firestore';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

function loadFirebaseConfig() {
  // Prefer environment variables
  const fromEnv = {
    apiKey: process.env.VITE_FIREBASE_API_KEY,
    authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: process.env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.VITE_FIREBASE_APP_ID,
    measurementId: process.env.VITE_FIREBASE_MEASUREMENT_ID
  };
  if (fromEnv.apiKey && fromEnv.projectId && fromEnv.appId) {
    return fromEnv;
  }

  // Fallback: parse public/config/firebaseConfig.js
  const publicCfgPath = path.join(projectRoot, 'public', 'config', 'firebaseConfig.js');
  if (!fs.existsSync(publicCfgPath)) {
    throw new Error('Firebase config not found in env or public/config/firebaseConfig.js');
  }
  const text = fs.readFileSync(publicCfgPath, 'utf8');
  const match = text.match(/__FIREBASE_CONFIG__\s*=\s*(\{[\s\S]*?\})\s*;/);
  if (!match) {
    throw new Error('Unable to parse firebaseConfig.js');
  }
  // The object is JSON-like already
  const json = match[1];
  const cfg = JSON.parse(json);
  return cfg;
}

function toDateFromPossibleTimestamp(v) {
  if (!v) return null;
  // Firestore Timestamp has toDate(); emulate duck-typing
  if (typeof v.toDate === 'function') {
    try { return v.toDate(); } catch {}
  }
  // Possibly { seconds, nanoseconds }
  if (typeof v === 'object' && Number.isFinite(v.seconds)) {
    const ms = (v.seconds * 1000) + Math.floor((v.nanoseconds || 0) / 1e6);
    return new Date(ms);
  }
  // Try parseable date string
  const ms = Date.parse(String(v));
  if (Number.isFinite(ms)) return new Date(ms);
  return null;
}

function formatAlphabeticalId(dt, oldId) {
  const baseIso = (dt || new Date(0)).toISOString().replace(/[:.]/g, '-');
  const suffix = String(oldId || '')
    .replace(/[^a-zA-Z0-9]/g, '')
    .slice(-4) || Math.random().toString(36).slice(2, 6);
  return `${baseIso}-${suffix}`;
}

function isAlreadyAlphaId(id) {
  return /^\d{4}-\d{2}-\d{2}T.+Z-[a-zA-Z0-9]+$/.test(String(id || ''));
}

async function migrateCollection(db, collName) {
  console.log(`\nScanning ${collName}…`);
  const snap = await getDocs(collection(db, collName));
  if (snap.empty) {
    console.log('  No documents found.');
    return;
  }
  const docs = [];
  snap.forEach(d => docs.push(d));
  // Sort by time asc to produce orderly IDs; fallback to ID sort
  docs.sort((a, b) => {
    const ad = toDateFromPossibleTimestamp(a.data()?.time) || new Date(0);
    const bd = toDateFromPossibleTimestamp(b.data()?.time) || new Date(0);
    const c = ad.getTime() - bd.getTime();
    if (c !== 0) return c;
    return String(a.id).localeCompare(String(b.id));
  });

  let processed = 0;
  let skipped = 0;
  let migrated = 0;
  let batch = writeBatch(db);
  let ops = 0;

  for (const d of docs) {
    processed++;
    const id = d.id;
    const data = d.data() || {};
    if (isAlreadyAlphaId(id)) {
      skipped++;
      continue;
    }
    const when = toDateFromPossibleTimestamp(data.time) || new Date(0);
    const newId = formatAlphabeticalId(when, id);
    const newRef = doc(db, collName, newId);
    const oldRef = d.ref;

    // copy as-is; no merges to guarantee identical content
    batch.set(newRef, data);
    batch.delete(oldRef);
    migrated++;
    ops += 2;
    if (ops >= 400) {
      await batch.commit();
      console.log(`  Committed ${ops} ops so far…`);
      batch = writeBatch(db);
      ops = 0;
    }
  }
  if (ops > 0) {
    await batch.commit();
  }

  console.log(`  ${collName}: processed=${processed}, migrated=${migrated}, skipped=${skipped}`);
}

async function main() {
  const cfg = loadFirebaseConfig();
  const app = initializeApp(cfg);
  const db = getFirestore(app);
  console.log(`Project: ${cfg.projectId}`);
  await migrateCollection(db, 'CardLogs');
  await migrateCollection(db, 'SealedLogs');
  console.log('\nMigration complete.');
}

main().catch(err => {
  console.error('Migration failed:', err?.message || err);
  process.exit(1);
});



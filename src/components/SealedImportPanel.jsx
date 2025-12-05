import React, { useRef, useState } from 'react';
import { firebaseApp } from '../firebase.js';
import { getFirestore, doc, setDoc } from 'firebase/firestore';

function parseLines(text) {
  const lines = String(text || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const out = [];
  for (const line of lines) {
    const parts = line.split(',').map(s => s.trim());
    if (parts.length >= 2) {
      const [name, price, image] = parts;
      out.push({
        name,
        cost: Number.parseFloat(price) || 0,
        image: image || ''
      });
    }
  }
  return out;
}

export default function SealedImportPanel({ lang, cat, setName, canEdit, onImported }) {
  const db = getFirestore(firebaseApp);
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(false);

  async function importFromFile(mode) {
    if (!canEdit) return;
    if (!lang || !cat || !setName) { alert('Select a set first.'); return; }
    const file = inputRef.current && inputRef.current.files && inputRef.current.files[0];
    if (!file) { alert('Choose a file first.'); return; }
    setBusy(true);
    try {
      const text = await file.text();
      let items = [];
      if (/\.json$/i.test(file.name)) {
        try {
          const data = JSON.parse(text);
          if (Array.isArray(data)) {
            items = data.map(x => ({
              name: x.name || x.title || '',
              cost: Number.parseFloat(String(x.cost || x.price || 0)) || 0,
              image: x.image || x.photo || x.img || ''
            })).filter(x => x.name);
          }
        } catch {}
      } else {
        items = parseLines(text);
      }
      if (items.length === 0) { alert('No items parsed.'); return; }
      let count = 0;
      for (const it of items) {
        const ref = doc(db, 'Pokemon Packs', lang, cat, setName, 'Sealed', it.name);
        const payload = {};
        if (mode === 'all' || mode === 'prices') payload['Cost'] = it.cost || 0;
        if (mode === 'all' || mode === 'photos') payload['Image'] = it.image || '';
        await setDoc(ref, payload, { merge: true });
        count++;
        if (count % 200 === 0) await new Promise(r => setTimeout(r, 5));
      }
      if (onImported) onImported();
      alert(`Imported ${count} sealed items (${mode}).`);
    } catch (e) {
      alert('Import failed: ' + (e && e.message ? e.message : String(e)));
    } finally {
      setBusy(false);
    }
  }

  if (!canEdit || !lang || !cat || !setName) return null;
  return (
    <div className="card">
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <div className="small muted">Import into {cat} / {setName} / Sealed</div>
      </div>
      <div className="small muted">Destination: Pokemon Packs / {lang} / {cat} / {setName} / Sealed</div>
      <div className="stack space-top">
        <input type="file" ref={inputRef} accept=".txt,.json,.csv,application/json,text/plain" />
      </div>
      <div className="stack space-top">
        <button className="btn" disabled={busy} onClick={() => importFromFile('all')}>Import All</button>
        <button className="btn ghost" disabled={busy} onClick={() => importFromFile('photos')}>Update Photos Only</button>
        <button className="btn ghost" disabled={busy} onClick={() => importFromFile('prices')}>Update Prices Only</button>
      </div>
    </div>
  );
}




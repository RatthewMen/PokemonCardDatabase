import React, { useEffect, useMemo, useState } from 'react';
import { firebaseApp } from '../firebase.js';
import {
  getFirestore,
  doc,
  writeBatch,
  serverTimestamp,
  collection,
  getDocs,
  increment
} from 'firebase/firestore';

export default function QuickEditModal({ open, onClose, lang, cat, setName, defaultView = 'Cards', onApplied }) {
  const db = useMemo(() => getFirestore(firebaseApp), []);
  const [view, setView] = useState(defaultView); // 'Cards' | 'Sealed'
  const [rows, setRows] = useState([{ id: 1, amount: '1' }]);
  const [cardIndex, setCardIndex] = useState({ byNumPrint: new Map(), byNum: new Map(), docName: new Map() });
  const [sealedOptions, setSealedOptions] = useState([]);

  useEffect(() => {
    if (open) setView(defaultView);
  }, [open, defaultView]);

  useEffect(() => {
    if (!open) return;
    if (view === 'Cards') {
      const arr = Array.from({ length: 10 }, (_, i) => ({ id: i + 1, amount: '1', location: '' }));
      setRows(arr);
    } else {
      setRows([{ id: 1, amount: '1', location: '' }]);
    }
  }, [open, view]);

  useEffect(() => {
    async function preload() {
      if (!open || !lang || !cat || !setName) return;
      // Build card lookup
      try {
        const snap = await getDocs(collection(db, 'Pokemon Packs', lang, cat, setName, 'Cards'));
        const byNumPrint = new Map();
        const byNum = new Map();
        const docName = new Map();
        snap.forEach(d => {
          const x = d.data() || {};
          const num = Number.parseInt(String(x['Number'] ?? 0), 10) || 0;
          const print = normalizePrint(String(x['Printing'] || 'Normal'));
          const nm = String(x['Name'] || d.id || '');
          if (num > 0) {
            byNumPrint.set(`${num}|${print}`, d.id);
            const arr = byNum.get(num) || [];
            arr.push(d.id);
            byNum.set(num, arr);
          }
          if (d.id) docName.set(d.id, nm);
        });
        setCardIndex({ byNumPrint, byNum, docName });
      } catch {}
      // Load sealed product names
      try {
        const sSnap = await getDocs(collection(db, 'Pokemon Packs', lang, cat, setName, 'Sealed'));
        const opts = [];
        sSnap.forEach(d => { if (!d.id.startsWith('_')) opts.push(d.id); });
        opts.sort((a, b) => a.localeCompare(b));
        setSealedOptions(opts);
      } catch {}
    }
    preload();
  }, [open, db, lang, cat, setName]);

  const normalizePrint = (v) => {
    const s = String(v || '').toLowerCase();
    if (s.includes('reverse')) return 'reverse';
    if (s.includes('holo')) return 'holo';
    return 'normal';
  };

  const addRow = () => setRows(rs => [...rs, { id: (rs.length ? Math.max(...rs.map(r => r.id)) : 0) + 1 }]);
  const removeRow = (id) => setRows(rs => rs.filter(r => r.id !== id));
  const updateRow = (id, patch) => setRows(rs => rs.map(r => (r.id === id ? { ...r, ...patch } : r)));

  // Generate a lexicographically sortable document ID based on current UTC time.
  // Example: 2025-12-13T20-15-03-123Z-abcd
  function generateAlphabeticalLogId() {
    const iso = new Date().toISOString().replace(/[:.]/g, '-'); // safe for Firestore IDs
    const suffix = Math.random().toString(36).slice(2, 6);
    return `${iso}-${suffix}`;
  }

  async function apply() {
    if (!lang || !cat || !setName) { alert('Select a set first.'); return; }
    const cleanRows = rows.map(r => {
      if (view === 'Cards') {
        return {
          type: 'card',
          number: Number.parseInt(String(r.number || '').trim(), 10) || 0,
          print: String(r.print || 'Normal').trim(),
          amount: Number.parseInt(String(r.amount ?? '1').trim(), 10) || 1,
          location: String(r.location || '').trim()
        };
      }
      return {
        type: 'sealed',
        // IMPORTANT: Use the exact doc ID selected without trimming to avoid creating new docs
        sealedName: String(r.sealedName || ''),
        amount: Number.parseInt(String(r.amount ?? '1').trim(), 10) || 1,
        location: String(r.location || '').trim()
      };
    // For sealed rows, check emptiness using a trimmed string but do not alter the stored ID
    }).filter(r => (r.type === 'card' ? r.number > 0 : String(r.sealedName ?? '').trim()));
    if (cleanRows.length === 0) { alert('Add at least one row.'); return; }

    const batch = writeBatch(db);
    const commits = [];
    let ops = 0;
    const flush = () => { commits.push(batch.commit()); };
    const notFound = [];

    for (const r of cleanRows) {
      if (r.type === 'card') {
        const key = `${r.number}|${normalizePrint(r.print)}`;
        let docId = cardIndex.byNumPrint.get(key);
        if (!docId) {
          const arr = cardIndex.byNum.get(r.number) || [];
          if (arr.length === 1) docId = arr[0];
        }
        if (!docId) { notFound.push(`#${r.number} (${r.print || 'Normal'})`); continue; }
        const ref = doc(db, 'Pokemon Packs', lang, cat, setName, 'Cards', docId);
        const payload = { 'Amount Owned': increment(r.amount) };
        if (r.location) payload['Location'] = r.location;
        // Backfill Name if missing using known name in index
        const knownName = cardIndex.docName.get(docId);
        if (knownName) payload['Name'] = knownName;
        batch.set(ref, payload, { merge: true });
      } else {
        const ref = doc(db, 'Pokemon Packs', lang, cat, setName, 'Sealed', r.sealedName);
        const payload = { 'Amount Owned': increment(r.amount) };
        if (r.location) payload['Location'] = r.location;
        batch.set(ref, payload, { merge: true });
      }
      ops++;
      if (ops >= 450) { flush(); ops = 0; }
    }
    if (ops > 0) commits.push(batch.commit());
    try {
      await Promise.all(commits);
      if (notFound.length) {
        alert('Some cards were not found by Number/Printing and were skipped:\n' + notFound.join('\n'));
      }
      // Logs
      const now = serverTimestamp();
      if (cleanRows.some(r => r.type === 'card')) {
        const logRef = doc(db, 'CardLogs', generateAlphabeticalLogId());
        await writeBatch(db).set(logRef, {
          time: now,
          items: cleanRows.filter(r => r.type === 'card').map(it => ({
            cardName: (function () {
              const key = `${it.number}|${normalizePrint(it.print)}`;
              const id = cardIndex.byNumPrint.get(key) || (cardIndex.byNum.get(it.number) || [])[0];
              return (id && cardIndex.docName.get(id)) || `Card #${it.number}`;
            })(),
            number: it.number,
            print: it.print,
            amount: it.amount,
            location: it.location,
            set: `${cat} / ${setName}`
          }))
        }).commit();
      }
      if (cleanRows.some(r => r.type === 'sealed')) {
        const logRef = doc(db, 'SealedLogs', generateAlphabeticalLogId());
        await writeBatch(db).set(logRef, {
          time: now,
          items: cleanRows.filter(r => r.type === 'sealed').map(it => ({
            sealedName: it.sealedName,
            amount: it.amount,
            location: it.location
          }))
        }).commit();
      }
      if (onApplied) onApplied();
      onClose();
    } catch (e) {
      alert('Update failed: ' + (e && e.message ? e.message : String(e)));
    }
  }

  if (!open) return null;
  return (
    <div className="modal-backdrop">
      <div className="modal-panel">
        <div className="modal-header">
          <div className="chip">{cat} / {setName} / {view}</div>
          <button className="btn ghost small" onClick={onClose} style={{ padding: '6px 8px' }}>Close</button>
        </div>
        <div className="modal-body">
          <div className="space-top">
            {view === 'Cards' ? (
              <div className="quick-list" key="cards">
                <div className="quick-cards-header">
                  <div>Number</div>
                  <div>Printing</div>
                  <div>Amount</div>
                  <div>Location</div>
                </div>
                {rows.map(r => (
                  <div key={r.id} className="quick-cards-row">
                    <input placeholder="#" onChange={e => updateRow(r.id, { number: e.target.value })} />
                    <select defaultValue="Normal" onChange={e => updateRow(r.id, { print: e.target.value })}>
                      <option>Normal</option>
                      <option>Reverse Holofoil</option>
                      <option>Holofoil</option>
                    </select>
                    <input placeholder="1" defaultValue="1" onChange={e => updateRow(r.id, { amount: e.target.value })} />
                    <input placeholder="optional" value={r.location || ''} onChange={e => updateRow(r.id, { location: e.target.value })} />
                  </div>
                ))}
              </div>
            ) : (
              <div className="quick-list" key="sealed">
                <div className="quick-sealed-header">
                  <div>Product</div>
                  <div>Amount</div>
                  <div>Location</div>
                </div>
                {rows.map(r => (
                  <div key={r.id} className="quick-sealed-row">
                    <select defaultValue="" onChange={e => updateRow(r.id, { sealedName: e.target.value })}>
                      <option value="" disabled>Select product</option>
                      {sealedOptions.map(n => <option key={n} value={n}>{n}</option>)}
                    </select>
                    <input placeholder="1" defaultValue="1" onChange={e => updateRow(r.id, { amount: e.target.value })} />
                    <input placeholder="optional" value={r.location || ''} onChange={e => updateRow(r.id, { location: e.target.value })} />
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn secondary" onClick={onClose}>Cancel</button>
          <button className="btn" onClick={apply}>Apply Updates</button>
        </div>
      </div>
    </div>
  );
}



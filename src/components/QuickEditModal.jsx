import React, { useMemo, useState } from 'react';
import { firebaseApp } from '../firebase.js';
import {
  getFirestore,
  doc,
  writeBatch,
  serverTimestamp,
  collection
} from 'firebase/firestore';

export default function QuickEditModal({ open, onClose, lang, cat, setName, defaultView = 'Cards', onApplied }) {
  const db = useMemo(() => getFirestore(firebaseApp), []);
  const [view, setView] = useState(defaultView); // 'Cards' | 'Sealed'
  const [rows, setRows] = useState([{ id: 1 }]);

  const addRow = () => setRows(rs => [...rs, { id: (rs.length ? Math.max(...rs.map(r => r.id)) : 0) + 1 }]);
  const removeRow = (id) => setRows(rs => rs.filter(r => r.id !== id));
  const updateRow = (id, patch) => setRows(rs => rs.map(r => (r.id === id ? { ...r, ...patch } : r)));

  async function apply() {
    if (!lang || !cat || !setName) { alert('Select a set first.'); return; }
    const cleanRows = rows.map(r => {
      if (view === 'Cards') {
        return {
          type: 'card',
          cardName: String(r.cardName || '').trim(),
          number: Number.parseInt(String(r.number || '').trim(), 10) || 0,
          print: String(r.print || '').trim(),
          amount: Number.parseInt(String(r.amount || '').trim(), 10) || 0,
          location: String(r.location || '').trim()
        };
      }
      return {
        type: 'sealed',
        sealedName: String(r.sealedName || '').trim(),
        amount: Number.parseInt(String(r.amount || '').trim(), 10) || 0,
        location: String(r.location || '').trim()
      };
    }).filter(r => (r.type === 'card' ? r.cardName : r.sealedName));
    if (cleanRows.length === 0) { alert('Add at least one row.'); return; }

    const batch = writeBatch(db);
    const commits = [];
    let ops = 0;
    const flush = () => { commits.push(batch.commit()); };

    for (const r of cleanRows) {
      if (r.type === 'card') {
        const ref = doc(db, 'Pokemon Packs', lang, cat, setName, 'Cards', r.cardName);
        batch.set(ref, {
          'Number': r.number,
          'Printing': r.print,
          'Amount Owned': r.amount,
          'Location': r.location
        }, { merge: true });
      } else {
        const ref = doc(db, 'Pokemon Packs', lang, cat, setName, 'Sealed', r.sealedName);
        batch.set(ref, {
          'Amount Owned': r.amount,
          'Location': r.location
        }, { merge: true });
      }
      ops++;
      if (ops >= 450) { flush(); ops = 0; }
    }
    if (ops > 0) commits.push(batch.commit());
    try {
      await Promise.all(commits);
      // Logs
      const now = serverTimestamp();
      if (cleanRows.some(r => r.type === 'card')) {
        const logRef = doc(collection(db, 'CardLogs'));
        await writeBatch(db).set(logRef, {
          time: now,
          items: cleanRows.filter(r => r.type === 'card').map(it => ({
            cardName: it.cardName,
            number: it.number,
            print: it.print,
            amount: it.amount,
            location: it.location,
            set: `${cat} / ${setName}`
          }))
        }).commit();
      }
      if (cleanRows.some(r => r.type === 'sealed')) {
        const logRef = doc(collection(db, 'SealedLogs'));
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
          <div className="small muted">Quick Edit</div>
          <div className="chip">{cat} / {setName} / {view}</div>
          <button className="btn ghost small" onClick={onClose} style={{ padding: '6px 8px' }}>Close</button>
        </div>
        <div className="modal-body">
          <div className="tabs">
            <button className={'tab-btn' + (view === 'Cards' ? ' active' : '')} onClick={() => setView('Cards')}>Cards</button>
            <button className={'tab-btn' + (view === 'Sealed' ? ' active' : '')} onClick={() => setView('Sealed')}>Sealed</button>
          </div>
          <div className="space-top">
            {rows.map(r => (
              <div key={r.id} className="grid-quick" style={{ marginBottom: 6 }}>
                {view === 'Cards' ? (
                  <>
                    <div className="hdr">Card</div>
                    <input placeholder="Name" onChange={e => updateRow(r.id, { cardName: e.target.value })} />
                    <div className="hdr">Number</div>
                    <input placeholder="0" onChange={e => updateRow(r.id, { number: e.target.value })} />
                    <div className="hdr">Print</div>
                    <input placeholder="Base/Reverse/Holo..." onChange={e => updateRow(r.id, { print: e.target.value })} />
                    <div className="hdr">Amount</div>
                    <input placeholder="0" onChange={e => updateRow(r.id, { amount: e.target.value })} />
                    <div className="hdr">Location</div>
                    <input placeholder="Binder A1..." onChange={e => updateRow(r.id, { location: e.target.value })} />
                  </>
                ) : (
                  <>
                    <div className="hdr">Sealed</div>
                    <input placeholder="Product Name" onChange={e => updateRow(r.id, { sealedName: e.target.value })} />
                    <div className="hdr">Amount</div>
                    <input placeholder="0" onChange={e => updateRow(r.id, { amount: e.target.value })} />
                    <div className="hdr">Location</div>
                    <input placeholder="Closet / Shelf..." onChange={e => updateRow(r.id, { location: e.target.value })} />
                  </>
                )}
                <div />
                <button className="btn secondary" onClick={() => removeRow(r.id)}>Remove</button>
              </div>
            ))}
            <div className="stack">
              <button className="btn ghost small" onClick={addRow}>Add Row</button>
            </div>
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



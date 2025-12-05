import React, { useEffect, useMemo, useState } from 'react';
import { firebaseApp } from '../firebase.js';
import {
  getFirestore,
  collection,
  getDocs,
  orderBy,
  limit,
  query
} from 'firebase/firestore';

function formatTs(ts) {
  try {
    if (!ts) return '';
    if (typeof ts.toDate === 'function') return ts.toDate().toLocaleString();
    const d = new Date(ts);
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleString();
  } catch {
    return '';
  }
}

export default function Logs() {
  const db = useMemo(() => getFirestore(firebaseApp), []);
  const [view, setView] = useState('card'); // 'card' | 'sealed'
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const coll = view === 'sealed' ? 'SealedLogs' : 'CardLogs';
      const snap = await getDocs(query(collection(db, coll), orderBy('time', 'desc'), limit(200)));
      const out = [];
      snap.forEach(d => out.push({ id: d.id, data: d.data() || {} }));
      setRows(out);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [view]);

  return (
    <div className="card">
      <div className="logs-header">
        <div className="logs-tabs">
          <button className={'tab-btn' + (view === 'card' ? ' active' : '')} onClick={() => setView('card')}>Cards</button>
          <button className={'tab-btn' + (view === 'sealed' ? ' active' : '')} onClick={() => setView('sealed')}>Sealed</button>
        </div>
      </div>
      <div className="divider"></div>
      {loading ? (
        <div className="small muted mono">Loading logs…</div>
      ) : rows.length === 0 ? (
        <div className="small muted">No logs yet.</div>
      ) : (
        <div style={{ overflow: 'auto' }}>
          <table className="table">
            <thead>
              {view === 'card' ? (
                <tr><th>Time</th><th>Card Name</th><th>Number</th><th>Print</th><th>Amount</th><th>Location</th><th>Set</th></tr>
              ) : (
                <tr><th>Time</th><th>Sealed Product</th><th>Amount</th><th>Location</th></tr>
              )}
            </thead>
            <tbody>
              {rows.map((r, idx) => {
                const d = r.data || {};
                const timeCell = (<td className="small mono">{formatTs(d.time)}</td>);
                if (view === 'card') {
                  if (Array.isArray(d.items)) {
                    return d.items.map((it, i) => (
                      <tr key={`${r.id}-${i}`}>
                        {timeCell}
                        <td>{it.cardName || ''}</td>
                        <td>{Number.isFinite(it.number) ? it.number : (it.number || '')}</td>
                        <td>{it.print || ''}</td>
                        <td>{Number.isFinite(it.amount) ? it.amount : (it.amount || '')}</td>
                        <td>{it.location || ''}</td>
                        <td>{it.set || ''}</td>
                      </tr>
                    ));
                  }
                  return (
                    <tr key={r.id}>
                      {timeCell}
                      <td>{d.cardName || ''}</td>
                      <td>{Number.isFinite(d.number) ? d.number : (d.number || '')}</td>
                      <td>{d.print || ''}</td>
                      <td>{Number.isFinite(d.amount) ? d.amount : (d.amount || '')}</td>
                      <td>{d.location || ''}</td>
                      <td>{d.set || ''}</td>
                    </tr>
                  );
                } else {
                  if (Array.isArray(d.items)) {
                    return d.items.map((it, i) => (
                      <tr key={`${r.id}-${i}`}>
                        {timeCell}
                        <td>{it.sealedName || ''}</td>
                        <td>{Number.isFinite(it.amount) ? it.amount : (it.amount || '')}</td>
                        <td>{it.location || ''}</td>
                      </tr>
                    ));
                  }
                  return (
                    <tr key={r.id}>
                      {timeCell}
                      <td>{d.sealedName || ''}</td>
                      <td>{Number.isFinite(d.amount) ? d.amount : (d.amount || '')}</td>
                      <td>{d.location || ''}</td>
                    </tr>
                  );
                }
              })}
            </tbody>
          </table>
        </div>
      )}
      <div className="small muted mono space-top">Count: {rows.length}</div>
    </div>
  );
}



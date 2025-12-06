import React, { useEffect, useMemo, useState } from 'react';
import { firebaseApp } from '../firebase.js';
import { getFirestore, collection, getDocs } from 'firebase/firestore';

export default function SealedList({ lang, cat, setName }) {
  const db = useMemo(() => getFirestore(firebaseApp), []);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!lang || !cat || !setName) { setRows([]); return; }
    async function load() {
      setLoading(true);
      try {
        const snap = await getDocs(collection(db, 'Pokemon Packs', lang, cat, setName, 'Sealed'));
        const out = [];
        snap.forEach(d => out.push({ id: d.id, data: d.data() || {} }));
        out.sort((a, b) => String(a.id || '').localeCompare(String(b.id || '')));
        setRows(out);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [db, lang, cat, setName]);

  if (!lang || !cat || !setName) return <div className="small muted">Select a set.</div>;
  if (loading) return <div className="small muted">Loading…</div>;
  if (rows.length === 0) return <div className="small muted">No sealed items.</div>;

  return (
    <div style={{ overflow: 'auto' }}>
      <table className="table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Owned</th>
            <th>Cost</th>
            <th>Location</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => {
            const d = r.data || {};
            return (
              <tr key={r.id}>
                <td>
                  <div className="thumb-wrap">
                    {(d['Image'] || d['Picture Link']) ? <img className="card-thumb" src={d['Image'] || d['Picture Link']} alt="" /> : null}
                  </div>
                  {r.id}
                </td>
                <td>{Number.isFinite(d['Amount Owned']) ? d['Amount Owned'] : (d['Amount Owned'] || 0)}</td>
                <td>{Number.isFinite(d['Cost']) ? d['Cost'] : (d['Cost'] || 0)}</td>
                <td>{d['Location'] || ''}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}



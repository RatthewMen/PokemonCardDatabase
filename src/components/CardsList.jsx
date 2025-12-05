import React, { useEffect, useMemo, useState } from 'react';
import { firebaseApp } from '../firebase.js';
import { getFirestore, collection, getDocs } from 'firebase/firestore';

export default function CardsList({ lang, cat, setName }) {
  const db = useMemo(() => getFirestore(firebaseApp), []);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!lang || !cat || !setName) { setRows([]); return; }
    async function load() {
      setLoading(true);
      try {
        const snap = await getDocs(collection(db, 'Pokemon Packs', lang, cat, setName, 'Cards'));
        const out = [];
        snap.forEach(d => out.push({ id: d.id, data: d.data() || {} }));
        // Sort by Number asc, then name
        out.sort((a, b) => {
          const an = Number(a.data['Number'] || 0);
          const bn = Number(b.data['Number'] || 0);
          if (Number.isFinite(an) && Number.isFinite(bn) && an !== bn) return an - bn;
          return String(a.id || '').localeCompare(String(b.id || ''));
        });
        setRows(out);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [db, lang, cat, setName]);

  if (!lang || !cat || !setName) return <div className="small muted">Select a set.</div>;
  if (loading) return <div className="small muted">Loading…</div>;
  if (rows.length === 0) return <div className="small muted">No cards.</div>;

  return (
    <div style={{ overflow: 'auto' }}>
      <table className="table">
        <thead>
          <tr>
            <th>#</th>
            <th>Name</th>
            <th>Printing</th>
            <th>Owned</th>
            <th>Cost</th>
            <th>Location</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => {
            const d = r.data || {};
            const displayName = d['Name'] || r.id;
            const img = d['Picture Link'] || d['Image'] || '';
            return (
              <tr key={r.id}>
                <td>{Number.isFinite(d['Number']) ? d['Number'] : (d['Number'] || '')}</td>
                <td>
                  <div className="thumb-wrap">
                    {img ? <img className="card-thumb" src={img} alt="" /> : null}
                  </div>
                  {displayName}
                </td>
                <td>{d['Printing'] || ''}</td>
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



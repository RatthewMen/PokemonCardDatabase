import React, { useRef, useState } from 'react';
import { firebaseApp } from '../firebase.js';
import { getFirestore, doc, setDoc, getDoc, collection, getDocs, query, where } from 'firebase/firestore';

function parseLines(text) {
  const lines = String(text || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const out = [];
  const looksLikeUrlOrImage = (s) => /^(https?:)?\/\//i.test(s) || /\.(png|jpe?g|gif|webp|svg)$/i.test(String(s || ''));
  for (const line of lines) {
    const parts = line.split(',').map(s => s.trim());
    if (parts.length < 2) continue;

    const name = parts[0];
    let printing = '';
    let number = 0;
    let price = 0;
    let image = '';
    let rarity = '';

    if (parts.length >= 5) {
      const [, pPrint, pNum, pPrice, pImg, pRarity] = parts;
      printing = pPrint || '';
      number = Number.parseInt(pNum, 10) || 0;
      price = Number.parseFloat(pPrice) || 0;
      image = pImg || '';
      if (parts.length >= 6) rarity = pRarity || '';
    } else if (parts.length === 4) {
      const [, p2, p3, p4] = parts;
      const p2Num = Number.parseInt(p2, 10);
      const p3Num = Number.parseInt(p3, 10);
      const p3Float = Number.parseFloat(p3);
      const p4Float = Number.parseFloat(p4);

      if (Number.isFinite(p2Num) && Number.isFinite(p3Float) && looksLikeUrlOrImage(p4)) {
        number = p2Num || 0;
        price = p3Float || 0;
        image = p4 || '';
      } else if (!Number.isFinite(p2Num) && Number.isFinite(p3Num)) {
        printing = p2 || '';
        number = p3Num || 0;
        if (looksLikeUrlOrImage(p4) || !Number.isFinite(p4Float)) {
          image = p4 || '';
        } else {
          price = p4Float || 0;
        }
      } else {
        number = Number.parseInt(p2, 10) || 0;
        price = Number.parseFloat(p3) || 0;
        image = p4 || '';
      }
    } else if (parts.length === 3) {
      const [, p2, p3] = parts;
      const p2Num = Number.parseInt(p2, 10);
      if (Number.isFinite(p2Num) && looksLikeUrlOrImage(p3)) {
        number = p2Num || 0;
        image = p3 || '';
      } else if (Number.isFinite(p2Num)) {
        number = p2Num || 0;
        price = Number.parseFloat(p3) || 0;
      } else {
        printing = p2 || '';
        if (looksLikeUrlOrImage(p3)) image = p3 || '';
        else price = Number.parseFloat(p3) || 0;
      }
    }

    out.push({
      name,
      printing,
      number,
      cost: price,
      image,
      rarity
    });
  }
  return out;
}

export default function ImportPanel({ lang, cat, setName, canEdit, onImported }) {
  const db = getFirestore(firebaseApp);
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(false);

  async function applyPhotosByNumberFromJson() {
    if (!canEdit) return;
    if (!lang || !cat || !setName) { alert('Select a set first.'); return; }
    const file = inputRef.current && inputRef.current.files && inputRef.current.files[0];
    if (!file) { alert('Choose a JSON file first.'); return; }
    if (!/\.json$/i.test(file.name)) { alert('Please select a .json file.'); return; }
    setBusy(true);
    try {
      const text = await file.text();
      let data = [];
      try {
        const parsed = JSON.parse(text);
        if (Array.isArray(parsed)) data = parsed;
      } catch (e) {
        alert('Invalid JSON.');
        return;
      }
      if (data.length === 0) { alert('No items in JSON.'); return; }
      // Build number -> imageUrl map (first non-empty wins)
      const map = new Map(); // key: raw number string (trimmed); value: imageUrl
      const nums = []; // Keep structured entries for numeric fallback
      for (const x of data) {
        const raw = String(x.number ?? '').trim();
        const image = x.image || x.Image || x.photo || x.Photo || x.img || x.picture || x.Picture || x['Picture Link'] || x.pictureLink || x.imageUrl || x.imageURL || x.url || '';
        if (!raw || !image) continue;
        if (!map.has(raw)) map.set(raw, image);
        const num = Number.parseInt(raw, 10);
        nums.push({ raw, num: Number.isFinite(num) ? num : null, image: map.get(raw) });
      }
      // Deduplicate numeric keys as well: prefer existing image mapping
      const numericMap = new Map(); // number -> image
      for (const ent of nums) {
        if (ent.num != null && !numericMap.has(ent.num)) numericMap.set(ent.num, ent.image);
      }
      let updated = 0;
      // For each mapping, update all cards with this Number (try numeric and string equality)
      for (const [raw, image] of map.entries()) {
        const num = Number.parseInt(raw, 10);
        // numeric query
        if (Number.isFinite(num)) {
          try {
            const qNum = query(collection(db, 'Pokemon Packs', lang, cat, setName, 'Cards'), where('Number', '==', num));
            const snapNum = await getDocs(qNum);
            for (const d of snapNum.docs) {
              await setDoc(d.ref, { 'Picture Link': image }, { merge: true });
              updated++;
            }
          } catch {}
        }
        // string query (in case some docs kept Number as string)
        try {
          const qStr = query(collection(db, 'Pokemon Packs', lang, cat, setName, 'Cards'), where('Number', '==', raw));
          const snapStr = await getDocs(qStr);
          for (const d of snapStr.docs) {
            await setDoc(d.ref, { 'Picture Link': image }, { merge: true });
            updated++;
          }
        } catch {}
        // throttle a tiny bit for courtesy
        await new Promise(r => setTimeout(r, 3));
      }
      if (onImported) onImported();
      alert(`Updated photos for ${updated} documents by matching Number.`);
    } catch (e) {
      alert('Update failed: ' + (e && e.message ? e.message : String(e)));
    } finally {
      setBusy(false);
    }
  }

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
              name: x.name || x.cardName || x.title || x.Name || '',
              printing: x.printing || x.Printing || x.variant || x.edition || '',
              number: Number.parseInt(String(x.number || x.no || x.Number || 0), 10) || 0,
              cost: Number.parseFloat(String(x.cost || x.price || x.Price || 0)) || 0,
              image: x.image || x.Image || x.photo || x.Photo || x.img || x.picture || x.Picture || x['Picture Link'] || x.pictureLink || x.imageUrl || x.imageURL || x.url || '',
              rarity: x.rarity || x.Rarity || x.rarityLabel || x.RarityLabel || ''
            })).filter(x => x.name);
          }
        } catch {}
      } else {
        items = parseLines(text);
      }
      if (items.length === 0) { alert('No items parsed.'); return; }
      let count = 0;
      for (const it of items) {
        const numPart = String(it.number ?? '').trim();
        const docId = String((it.name || '') + (it.printing || '') + numPart).replace(/\s+/g, '');
        const ref = doc(db, 'Pokemon Packs', lang, cat, setName, 'Cards', docId);
        const existing = await getDoc(ref);
        const payload = {};
        if (mode === 'all' || mode === 'prices') payload['Cost'] = it.cost || 0;
         if ((mode === 'all' || mode === 'photos') && it.image) {
           // Only store Picture Link for cards; do not set Image
           payload['Picture Link'] = it.image;
         }
        // Always persist identity/display fields
        payload['Name'] = it.name || '';
        if (it.printing) payload['Printing'] = it.printing;
        if (it.rarity) payload['Rarity'] = it.rarity;
        payload['Number'] = it.number || 0;
        // Defaults for new docs only
        if (!existing.exists()) {
          payload['Amount Owned'] = 0;
          payload['Location'] = 'N/A';
        }
        await setDoc(ref, payload, { merge: true });
        count++;
        if (count % 200 === 0) await new Promise(r => setTimeout(r, 5));
      }
      if (onImported) onImported();
      alert(`Imported ${count} items (${mode}).`);
    } catch (e) {
      alert('Import failed: ' + (e && e.message ? e.message : String(e)));
    } finally {
      setBusy(false);
    }
  }

  /* removed: migration and recovery helpers */

  if (!canEdit || !lang || !cat || !setName) return null;
  return (
    <div className="card">
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <div className="small muted">Import into {cat} / {setName} / Cards</div>
      </div>
      <div className="small muted">Destination: Pokemon Packs / {lang} / {cat} / {setName} / Cards</div>
      <div className="stack space-top">
        <input type="file" ref={inputRef} accept=".txt,.json,.csv,application/json,text/plain" />
      </div>
      <div className="stack space-top">
        <button className="btn" disabled={busy} onClick={() => importFromFile('all')}>Import All</button>
        <button className="btn ghost" disabled={busy} onClick={() => importFromFile('prices')}>Update Prices Only</button>
        <button className="btn ghost" disabled={busy} onClick={applyPhotosByNumberFromJson} title="Use JSON with { name, number, imageUrl } to update all printings that share the same number">Update Photos (PkmnCards)</button>
      </div>
    </div>
  );
}






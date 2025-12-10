import React, { useEffect, useMemo, useState } from 'react';
import { firebaseApp } from '../firebase.js';
import {
  getFirestore,
  collectionGroup,
  getDocs,
  doc,
  getDoc,
  setDoc,
  collection
} from 'firebase/firestore';
import { useAuth } from '../context/AuthContext.jsx';
import CardsList from '../components/CardsList.jsx';
import SealedList from '../components/SealedList.jsx';
import QuickEditModal from '../components/QuickEditModal.jsx';
import ImportPanel from '../components/ImportPanel.jsx';
import SealedImportPanel from '../components/SealedImportPanel.jsx';

function readCookie(name) {
  try {
    const match = document.cookie.split('; ').find(row => row.startsWith(name + '='));
    if (!match) return null;
    return decodeURIComponent(match.split('=')[1] || '');
  } catch {
    return null;
  }
}
function writeCookie(name, value, days = 365) {
  try {
    const expires = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toUTCString();
    document.cookie = `${name}=${encodeURIComponent(value)}; expires=${expires}; path=/; SameSite=Lax`;
  } catch {}
}
function loadOpenFromCookie() {
  try {
    const raw = readCookie('db_open');
    if (!raw) return {};
    const obj = JSON.parse(raw);
    return obj && typeof obj === 'object' ? obj : {};
  } catch {
    return {};
  }
}
function saveOpenToCookie(obj) {
  try { writeCookie('db_open', JSON.stringify(obj), 365); } catch {}
}

function formatCurrency(n) {
  try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n) || 0); } catch (_) { return '$' + (Number(n).toFixed ? Number(n).toFixed(2) : String(n)); }
}

async function computeSetAggregates(db, lang, cat, setName) {
  let totalValue = 0;
  let totalCardAmount = 0;
  let totalPacksOpened = 0;
  try {
    const setSnap = await getDoc(doc(db, 'Pokemon Packs', lang, cat, setName));
    const setData = setSnap.exists() ? (setSnap.data() || {}) : {};
    totalPacksOpened = Number(
      setData['TotalPacksOpened'] || setData['Packs Opened'] || setData['PacksOpened'] || setData['Opened Packs'] || 0
    ) || 0;
  } catch {}
  try {
    const cardsSnap = await getDocs(collectionGroup(db, 'Cards'));
    cardsSnap.forEach(d => {
      const data = d.data() || {};
      const parts = d.ref.path.split('/');
      if (parts.length >= 6 && parts[0] === 'Pokemon Packs') {
        const l = parts[1], c = parts[2], s = parts[3];
        if (l === lang && c === cat && s === setName) {
          const owned = Number(data['Amount Owned'] || data['AmountOwned'] || data['Owned'] || 0) || 0;
          const cost = Number(data['Cost'] || 0) || 0;
          totalValue += Math.max(0, owned * cost);
          totalCardAmount += Math.max(0, owned);
        }
      }
    });
  } catch {}
  try {
    const sealedSnap = await getDocs(collectionGroup(db, 'Sealed'));
    sealedSnap.forEach(d => {
      const data = d.data() || {};
      const parts = d.ref.path.split('/');
      if (parts.length >= 6 && parts[0] === 'Pokemon Packs') {
        const l = parts[1], c = parts[2], s = parts[3];
        if (l === lang && c === cat && s === setName) {
          const owned = Number(data['Amount Owned'] || data['AmountOwned'] || data['Owned'] || 0) || 0;
          const cost = Number(data['Cost'] || 0) || 0;
          totalValue += Math.max(0, owned * cost);
        }
      }
    });
  } catch {}
  return { totalValue, totalCardAmount, totalPacksOpened };
}

export default function Database() {
  const db = useMemo(() => getFirestore(firebaseApp), []);
  const { canEdit } = useAuth();
  const [structure, setStructure] = useState({}); // { lang: { cat: { setName: { hasCards, hasSealed }}}}
  const [selection, setSelection] = useState({ lang: '', cat: '', setName: '' });
  const [aggregates, setAggregates] = useState(null);
  const [setMeta, setSetMeta] = useState(null);
  const [loadingTree, setLoadingTree] = useState(false);
  const [loadingAgg, setLoadingAgg] = useState(false);
  const [loadingMeta, setLoadingMeta] = useState(false);
  const [open, setOpen] = useState(() => loadOpenFromCookie()); // keys like 'lang:English', 'cat:English:Base', 'set:English:Base:SetName'
  const [showAddCategory, setShowAddCategory] = useState(false);
  const [showAddSet, setShowAddSet] = useState(false);
  const [newCategory, setNewCategory] = useState('');
  const [newSet, setNewSet] = useState({ name: '', cards: '', totalCards: '', image: '', canCards: false, canSealed: false });
  const [view, setView] = useState('Overview'); // Overview | Cards | Sealed
  const [showQuickEdit, setShowQuickEdit] = useState(false);
  const [loadingTop, setLoadingTop] = useState(false);
  const [topByValue, setTopByValue] = useState([]); // [{name,image,amount,total}]
  const [topByQty, setTopByQty] = useState([]);     // [{name,image,amount,total}]
  const [savingFlag, setSavingFlag] = useState(null); // 'cards' | 'sealed' | null

  function toggleOpenKey(key) {
    setOpen(o => {
      const next = { ...o, [key]: !o[key] };
      saveOpenToCookie(next);
      return next;
    });
  }

  useEffect(() => {
    async function loadStructure() {
      setLoadingTree(true);
      try {
        const ensure = (obj, lang, cat, set) => {
          obj[lang] = obj[lang] || {};
          obj[lang][cat] = obj[lang][cat] || {};
          obj[lang][cat][set] = obj[lang][cat][set] || { hasCards: false, hasSealed: false };
          return obj[lang][cat][set];
        };
        const struct = {};
        // Include all languages, even if empty
        try {
          const langsSnap = await getDocs(collection(db, 'Pokemon Packs'));
          langsSnap.forEach(d => {
            const lang = d.id;
            if (!/^_/.test(lang)) {
              struct[lang] = struct[lang] || {};
            }
          });
        } catch {}
        const cardsSnap = await getDocs(collectionGroup(db, 'Cards'));
        cardsSnap.forEach(d => {
          const parts = d.ref.path.split('/');
          if (parts.length >= 6 && parts[0] === 'Pokemon Packs') {
            const lang = parts[1];
            const cat = parts[2];
            const setName = parts[3];
            ensure(struct, lang, cat, setName).hasCards = true;
          }
        });
        const sealedSnap = await getDocs(collectionGroup(db, 'Sealed'));
        sealedSnap.forEach(d => {
          const parts = d.ref.path.split('/');
          if (parts.length >= 6 && parts[0] === 'Pokemon Packs') {
            const lang = parts[1];
            const cat = parts[2];
            const setName = parts[3];
            ensure(struct, lang, cat, setName).hasSealed = true;
          }
        });
        setStructure(struct);
      } finally {
        setLoadingTree(false);
      }
    }
    loadStructure();
  }, [db]);

  useEffect(() => {
    if (!selection.lang || !selection.cat || !selection.setName) {
      setAggregates(null);
      setSetMeta(null);
      setTopByValue([]);
      setTopByQty([]);
      return;
    }
    setLoadingAgg(true);
    computeSetAggregates(db, selection.lang, selection.cat, selection.setName).then(setAggregates).finally(() => setLoadingAgg(false));
    setLoadingMeta(true);
    getDoc(doc(db, 'Pokemon Packs', selection.lang, selection.cat, selection.setName))
      .then(s => setSetMeta(s.exists() ? (s.data() || {}) : null))
      .finally(() => setLoadingMeta(false));
    // Load top lists from this set's Cards
    (async () => {
      setLoadingTop(true);
      try {
        const snap = await getDocs(collection(db, 'Pokemon Packs', selection.lang, selection.cat, selection.setName, 'Cards'));
        const items = [];
        snap.forEach(d => {
          const x = d.data() || {};
          const name = x['Name'] || d.id;
          const printingRaw = x['Printing'] || x['Print'] || '';
          const printingTrim = String(printingRaw || '').trim();
          const printing = (/^normal$/i.test(printingTrim) ? '' : printingTrim);
          const amount = Number(x['Amount Owned'] || x['AmountOwned'] || x['Owned'] || 0) || 0;
          const cost = Number(x['Cost'] || 0) || 0;
          const total = Math.max(0, amount * cost);
          const image = x['Picture Link'] || x['Image'] || '';
          items.push({ name, printing, amount, cost, total, image });
        });
        const byValue = items.slice().sort((a, b) => b.total - a.total).slice(0, 5);
        const byQty = items.slice().sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name)).slice(0, 5);
        setTopByValue(byValue);
        setTopByQty(byQty);
      } finally {
        setLoadingTop(false);
      }
    })();
  }, [db, selection]);

  const langs = useMemo(() => Object.keys(structure).sort((a, b) => a.localeCompare(b)), [structure]);

  async function updateImportFlag(field, nextValue) {
    if (!(selection.lang && selection.cat && selection.setName)) return;
    setSavingFlag(field === 'CanImportCards' ? 'cards' : 'sealed');
    const ref = doc(db, 'Pokemon Packs', selection.lang, selection.cat, selection.setName);
    // optimistic update
    setSetMeta(m => ({ ...(m || {}), [field]: !!nextValue }));
    try {
      await setDoc(ref, { [field]: !!nextValue }, { merge: true });
    } catch (e) {
      // revert on failure
      setSetMeta(m => ({ ...(m || {}), [field]: !(!!nextValue) }));
      alert('Failed to update setting: ' + (e && e.message ? e.message : String(e)));
    } finally {
      setSavingFlag(null);
    }
  }

  async function refreshStructure() {
    setLoadingTree(true);
    try {
      const ensure = (obj, lang, cat, set) => {
        obj[lang] = obj[lang] || {};
        obj[lang][cat] = obj[lang][cat] || {};
        obj[lang][cat][set] = obj[lang][cat][set] || { hasCards: false, hasSealed: false };
        return obj[lang][cat][set];
      };
      const struct = {};
      try {
        const langsSnap = await getDocs(collection(db, 'Pokemon Packs'));
        langsSnap.forEach(d => {
          const lang = d.id;
          if (!/^_/.test(lang)) {
            struct[lang] = struct[lang] || {};
          }
        });
      } catch {}
      const cardsSnap = await getDocs(collectionGroup(db, 'Cards'));
      cardsSnap.forEach(d => {
        const parts = d.ref.path.split('/');
        if (parts.length >= 6 && parts[0] === 'Pokemon Packs') {
          const lang = parts[1];
          const cat = parts[2];
          const setName = parts[3];
          ensure(struct, lang, cat, setName).hasCards = true;
        }
      });
      const sealedSnap = await getDocs(collectionGroup(db, 'Sealed'));
      sealedSnap.forEach(d => {
        const parts = d.ref.path.split('/');
        if (parts.length >= 6 && parts[0] === 'Pokemon Packs') {
          const lang = parts[1];
          const cat = parts[2];
          const setName = parts[3];
          ensure(struct, lang, cat, setName).hasSealed = true;
        }
      });
      setStructure(struct);
    } finally {
      setLoadingTree(false);
    }
  }

  const [categorySets, setCategorySets] = useState([]); // [{name, data}]
  const [loadingCategorySets, setLoadingCategorySets] = useState(false);
  const [categoryAggs, setCategoryAggs] = useState({}); // name -> aggregates
  const [categoryMeta, setCategoryMeta] = useState({}); // name -> meta doc
  const [loadingCategoryAggs, setLoadingCategoryAggs] = useState(false);
  useEffect(() => {
    setCategorySets([]);
    if (!(selection.lang && selection.cat)) return;
    if (selection.setName) return;
    async function loadCategorySets() {
      setLoadingCategorySets(true);
      try {
        const snap = await getDocs(collection(db, 'Pokemon Packs', selection.lang, selection.cat));
        const out = [];
        snap.forEach(s => {
          const name = s.id;
          if (!/^_/.test(name)) out.push({ name, data: s.data() || {} });
        });
        out.sort((a, b) => a.name.localeCompare(b.name));
        setCategorySets(out);
      } finally {
        setLoadingCategorySets(false);
      }
    }
    loadCategorySets();
  }, [db, selection.lang, selection.cat, selection.setName]);

  // When viewing a category, precompute per-set summaries to match the large overview cards
  useEffect(() => {
    if (!(selection.lang && selection.cat) || selection.setName) return;
    if (categorySets.length === 0) {
      setCategoryAggs({});
      setCategoryMeta({});
      return;
    }
    async function loadAggs() {
      setLoadingCategoryAggs(true);
      try {
        const results = await Promise.all(categorySets.map(async s => {
          const [metaSnap, aggs] = await Promise.all([
            getDoc(doc(db, 'Pokemon Packs', selection.lang, selection.cat, s.name)),
            computeSetAggregates(db, selection.lang, selection.cat, s.name)
          ]);
          return { name: s.name, meta: metaSnap.exists() ? (metaSnap.data() || {}) : {}, aggs };
        }));
        const aggsMap = {};
        const metaMap = {};
        results.forEach(r => { aggsMap[r.name] = r.aggs; metaMap[r.name] = r.meta; });
        setCategoryAggs(aggsMap);
        setCategoryMeta(metaMap);
      } finally {
        setLoadingCategoryAggs(false);
      }
    }
    loadAggs();
  }, [db, selection.lang, selection.cat, selection.setName, categorySets]);

  return (
    <div className="db-layout">
      <div className="card" style={{ padding: 0 }}>
        <div className="row" style={{ padding: '10px 12px', justifyContent: 'flex-end' }}>
          <div className="stack">
            <button className="btn ghost small" onClick={refreshStructure}>Refresh</button>
          </div>
        </div>
        <div style={{ padding: '4px 6px' }}>
          {loadingTree ? <div className="small muted">Loading…</div> : (
            <ul className="tree">
              <li className="tree-node">
                <div className="tree-row" onClick={() => toggleOpenKey('root')}>
                  <div className="tree-caret" />
                  <div className="tree-label">Pokemon Packs</div>
                </div>
                <div className="tree-children" style={{ display: open.root ? '' : 'none' }}>
                  {langs.length === 0 ? <div className="small muted" style={{ padding: '6px 8px' }}>No data found.</div> :
                    langs.map(lang => {
                      const cats = Object.keys(structure[lang] || {}).sort((a, b) => a.localeCompare(b));
                      const kLang = `lang:${lang}`;
                      return (
                        <div key={lang} className="tree-node">
                          <div className="tree-row" onClick={() => toggleOpenKey(kLang)}>
                            <div className="tree-caret" />
                            <div
                              className="tree-label"
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelection({ lang, cat: '', setName: '' });
                              }}
                            >{lang}</div>
                          </div>
                          <div className="tree-children" style={{ display: open[kLang] ? '' : 'none' }}>
                            {cats.length === 0 ? <div className="small muted" style={{ padding: '6px 8px' }}>No categories.</div> :
                              cats.map(cat => {
                                const setsMap = structure[lang][cat] || {};
                                const setNames = Object.keys(setsMap).filter(n => !/^_/.test(n)).sort((a, b) => a.localeCompare(b));
                                const kCat = `cat:${lang}:${cat}`;
                                return (
                                  <div key={cat} className="tree-node">
                                    <div className="tree-row" onClick={() => toggleOpenKey(kCat)}>
                                      <div className="tree-caret" />
                                      <div
                                        className="tree-label"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setSelection({ lang, cat, setName: '' });
                                        }}
                                      >{cat}</div>
                                    </div>
                                    <div className="tree-children" style={{ display: open[kCat] ? '' : 'none' }}>
                                      {setNames.length === 0 ? <div className="small muted" style={{ padding: '6px 8px' }}>No sets.</div> :
                                        setNames.map(setName => {
                                          const kSet = `set:${lang}:${cat}:${setName}`;
                                          const flags = setsMap[setName] || { hasCards: true, hasSealed: true };
                                          return (
                                            <div key={setName} className="tree-node">
                                              <div className="tree-row" onClick={() => toggleOpenKey(kSet)}>
                                                <div className="tree-caret" />
                                                <div className="tree-label" onClick={(e) => { e.stopPropagation(); setSelection({ lang, cat, setName }); setView('Overview'); }}>{setName}</div>
                                              </div>
                                              <div className="tree-children" style={{ display: open[kSet] ? '' : 'none' }}>
                                                <div className="tree-node">
                                                  <div className="tree-row" onClick={() => { setSelection({ lang, cat, setName }); setView('Cards'); }}>
                                                    <div className="tree-label">Cards</div>
                                                  </div>
                                                </div>
                                                <div className="tree-node">
                                                  <div className="tree-row" onClick={() => { setSelection({ lang, cat, setName }); setView('Sealed'); }}>
                                                    <div className="tree-label">Sealed</div>
                                                  </div>
                                                </div>
                                              </div>
                                            </div>
                                          );
                                        })}
                                    </div>
                                  </div>
                                );
                              })}
                          </div>
                        </div>
                      );
                    })}
                </div>
              </li>
            </ul>
          )}
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
        
        {canEdit && (
          <div className="row">
            <div className="stack">
              {(selection.lang && !selection.cat && !selection.setName) ? (
                <button className="btn ghost small" onClick={() => setShowAddCategory(true)}>Add Category</button>
              ) : null}
              {(selection.lang && selection.cat && !selection.setName) ? (
                <button className="btn small" onClick={() => setShowAddSet(true)}>Add Set</button>
              ) : null}
            </div>
          </div>
        )}
        {null}
        {(!selection.lang) ? (
          <div className="card"><div className="small muted">Select a language from the tree.</div></div>
        ) : (!selection.cat) ? (
          <div className="card">
            <div className="row" style={{ justifyContent: 'flex-start', alignItems: 'center' }}>
              <div className="small muted" style={{ flex: 1 }}>Categories</div>
              {canEdit ? <button className="btn" onClick={() => setShowAddCategory(true)}>Add Category</button> : null}
            </div>
            <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 8 }}>
              {Object.keys(structure[selection.lang] || {}).length === 0 ? (
                <div className="small muted">No categories.</div>
              ) : (
                Object.keys(structure[selection.lang] || {})
                  .sort((a, b) => a.localeCompare(b))
                  .map(cat => {
                    const setsMap = structure[selection.lang]?.[cat] || {};
                    const setNames = Object.keys(setsMap).filter(n => !/^_/.test(n)).sort((a, b) => a.localeCompare(b));
                    return (
                      <div key={cat} className="card">
                        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                          <div className="section-title" style={{ marginBottom: 0 }}>{cat}</div>
                        </div>
                        <ul style={{ listStyle: 'disc', paddingLeft: 18, margin: 0, marginTop: 6 }}>
                          {setNames.length === 0 ? (
                            <li className="small muted" style={{ listStyle: 'none' }}>No sets</li>
                          ) : (
                            setNames.map(name => (
                              <li key={name} style={{ cursor: 'pointer' }} onClick={() => setSelection(s => ({ ...s, cat, setName: name }))}>
                                {name}
                              </li>
                            ))
                          )}
                        </ul>
                      </div>
                    );
                  })
              )}
            </div>
          </div>
        ) : (!selection.setName) ? (
          <div className="card">
            <div className="small muted">Sets in {selection.cat}</div>
            {(loadingCategorySets || loadingCategoryAggs) ? <div className="small muted">Loading…</div> : (
              <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 8 }}>
                {categorySets.map(s => {
                  const meta = categoryMeta[s.name] || s.data || {};
                  const aggs = categoryAggs[s.name] || { totalValue: 0, totalCardAmount: 0, totalPacksOpened: 0 };
                  return (
                    <div key={s.name} className="card" style={{ cursor: 'pointer' }} onClick={() => setSelection(sel => ({ ...sel, setName: s.name }))}>
                      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                        <div className="section-title" style={{ marginBottom: 0 }}>{s.name}</div>
                        {meta.image ? <img className="set-image" src={meta.image} alt="" /> : <div className="set-image" />}
                      </div>
                      <div className="divider"></div>
                      <ul className="kv-list">
                        <li className="kv-item"><span className="kv-label small">Cards</span><span className="mono">{aggs.totalCardAmount}</span></li>
                        <li className="kv-item"><span className="kv-label small">Total Cards</span><span className="mono">{Number.isFinite(meta['Total Cards']) ? meta['Total Cards'] : 0}</span></li>
                        <li className="kv-item"><span className="kv-label small">Total Value</span><span className="mono">{formatCurrency(aggs.totalValue)}</span></li>
                        <li className="kv-item"><span className="kv-label small">Total Amount of Cards</span><span className="mono">{aggs.totalCardAmount}</span></li>
                        <li className="kv-item"><span className="kv-label small">Total Packs Opened</span><span className="mono">{aggs.totalPacksOpened}</span></li>
                      </ul>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ) : (
          <>
            <div className="stack">
              {canEdit && view !== 'Overview' ? (
                <button className="btn small" onClick={() => setShowQuickEdit(true)} title="Quickly add cards and update location">Edit Card / Sealed Amount</button>
              ) : null}
            </div>
            {(canEdit && view === 'Cards' && setMeta && setMeta['CanImportCards']) ? (
              <div className="space-top">
                <ImportPanel lang={selection.lang} cat={selection.cat} setName={selection.setName} canEdit={canEdit} onImported={() => {
                  if (view === 'Overview') {
                    computeSetAggregates(db, selection.lang, selection.cat, selection.setName).then(setAggregates);
                  }
                }} />
              </div>
            ) : null}
            {(canEdit && view === 'Sealed' && setMeta && setMeta['CanImportSealed']) ? (
              <div className="space-top">
                <SealedImportPanel
                  lang={selection.lang}
                  cat={selection.cat}
                  setName={selection.setName}
                  canEdit={canEdit}
                  onImported={() => {
                    if (view === 'Overview') {
                      computeSetAggregates(db, selection.lang, selection.cat, selection.setName).then(setAggregates);
                    }
                  }}
                />
              </div>
            ) : null}
            <div id="dbSetDetails">
              {view === 'Overview' ? (
                loadingAgg ? (
                  <div className="small muted">Loading set…</div>
                ) : aggregates ? (
                  <div className="card">
                    <div className="set-overview">
                      <ul className="kv-list">
                        <li className="kv-item"><span className="kv-label small">Language</span><span className="mono">{selection.lang}</span></li>
                        <li className="kv-item"><span className="kv-label small">Category</span><span className="mono">{selection.cat}</span></li>
                        <li className="kv-item"><span className="kv-label small">Set</span><span className="mono">{selection.setName}</span></li>
                        <li className="kv-item"><span className="kv-label small">Cards</span><span className="mono">{(setMeta && (Number.isFinite(setMeta['Cards']) ? setMeta['Cards'] : setMeta['Cards'])) || topByQty.reduce((s, i) => s, 0) || (/* fallback unknown */ 0)}</span></li>
                        <li className="kv-item"><span className="kv-label small">Total Cards</span><span className="mono">{(setMeta && (Number.isFinite(setMeta['Total Cards']) ? setMeta['Total Cards'] : 0)) || 0}</span></li>
                        <li className="kv-item"><span className="kv-label small">Total Value</span><span className="mono">{formatCurrency(aggregates.totalValue)}</span></li>
                        <li className="kv-item"><span className="kv-label small">Total Amount of Cards</span><span className="mono">{aggregates.totalCardAmount}</span></li>
                        <li className="kv-item"><span className="kv-label small">Total Packs Opened</span><span className="mono">{aggregates.totalPacksOpened}</span></li>
                        {loadingMeta ? null : (
                          <li className="kv-item">
                            <span className="kv-label small">Can Import Cards</span>
                            <label className="switch">
                              <input
                                type="checkbox"
                                checked={!!(setMeta && setMeta['CanImportCards'])}
                                onChange={e => updateImportFlag('CanImportCards', e.target.checked)}
                                disabled={savingFlag === 'cards'}
                              />
                              <span className="slider" />
                            </label>
                          </li>
                        )}
                        {loadingMeta ? null : (
                          <li className="kv-item">
                            <span className="kv-label small">Can Import Sealed</span>
                            <label className="switch">
                              <input
                                type="checkbox"
                                checked={!!(setMeta && setMeta['CanImportSealed'])}
                                onChange={e => updateImportFlag('CanImportSealed', e.target.checked)}
                                disabled={savingFlag === 'sealed'}
                              />
                              <span className="slider" />
                            </label>
                          </li>
                        )}
                      </ul>
                      {setMeta && setMeta.image ? <img className="set-image" src={setMeta.image} alt="" /> : null}
                    </div>

                    <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', marginTop: 12 }}>
                      <div className="card">
                        <div className="small muted">Top 5 by Total Value</div>
                        <div className="divider"></div>
                        {loadingTop ? <div className="small muted">Loading…</div> : (
                          <div style={{ display: 'grid', gap: 12 }}>
                            {topByValue.map(it => (
                              <div key={it.name + '|' + (it.printing || '')} className="row" style={{ alignItems: 'center' }}>
                                <div className="thumb-wrap">{it.image ? <img className="card-thumb" src={it.image} alt="" /> : null}</div>
                                <div style={{ flex: 1 }}>{it.name}{it.printing ? ` (${it.printing})` : ''}</div>
                                <div className="mono">x{it.amount} {formatCurrency(it.total)}</div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="card">
                        <div className="small muted">Top 5 by Quantity</div>
                        <div className="divider"></div>
                        {loadingTop ? <div className="small muted">Loading…</div> : (
                          <div style={{ display: 'grid', gap: 12 }}>
                            {topByQty.map(it => (
                              <div key={it.name + '|' + (it.printing || '')} className="row" style={{ alignItems: 'center' }}>
                                <div className="thumb-wrap">{it.image ? <img className="card-thumb" src={it.image} alt="" /> : null}</div>
                                <div style={{ flex: 1 }}>{it.name}{it.printing ? ` (${it.printing})` : ''}</div>
                                <div className="mono">x{it.amount}</div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ) : <div className="small muted">No data.</div>
              ) : view === 'Cards' ? (
                <div className="card"><CardsList lang={selection.lang} cat={selection.cat} setName={selection.setName} /></div>
              ) : view === 'Sealed' ? (
                <div className="card"><SealedList lang={selection.lang} cat={selection.cat} setName={selection.setName} /></div>
              ) : null}
            </div>
          </>
        )}
      </div>
      <QuickEditModal
        open={showQuickEdit}
        onClose={() => setShowQuickEdit(false)}
        lang={selection.lang}
        cat={selection.cat}
        setName={selection.setName}
        defaultView={view === 'Sealed' ? 'Sealed' : 'Cards'}
        onApplied={() => {
          if (view === 'Overview') {
            computeSetAggregates(db, selection.lang, selection.cat, selection.setName).then(setAggregates);
          }
        }}
      />
      {showAddCategory && (
        <div className="modal-backdrop">
          <div className="modal-panel">
            <div className="modal-header">
              <div className="small">Add Category</div>
              <button className="btn ghost small" onClick={() => setShowAddCategory(false)}>Close</button>
            </div>
            <div className="modal-body">
              <div className="small muted">Language: {selection.lang || 'English'}</div>
              <div className="space-top">
                <input placeholder="Category name" value={newCategory} onChange={e => setNewCategory(e.target.value)} style={{ padding: 8, border: '1px solid #E2E8F0', borderRadius: 8, width: '100%' }} />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn secondary" onClick={() => setShowAddCategory(false)}>Cancel</button>
              <button className="btn" onClick={async () => {
                const cat = String(newCategory || '').trim();
                if (!cat) { alert('Enter category name.'); return; }
                try {
                  const lang = selection.lang || 'English';
                  const ref = doc(db, 'Pokemon Packs', lang, cat, '_placeholder');
                  await setDoc(ref, { hidden: true }, { merge: true });
                  await setDoc(doc(db, 'Pokemon Packs', lang, cat, '_placeholder', 'Cards', '_init'), { placeholder: true }, { merge: true });
                  setShowAddCategory(false);
                  setNewCategory('');
                  // Refresh structure
                  const structCopy = { ...structure };
                  structCopy[lang] = structCopy[lang] || {};
                  structCopy[lang][cat] = structCopy[lang][cat] || {};
                  setStructure(structCopy);
                } catch (e) {
                  alert('Create category failed: ' + (e && e.message ? e.message : String(e)));
                }
              }}>Create</button>
            </div>
          </div>
        </div>
      )}
      {showAddSet && (
        <div className="modal-backdrop">
          <div className="modal-panel">
            <div className="modal-header">
              <div className="chip">{selection.lang || 'English'} / {selection.cat || ''}</div>
              <button className="btn ghost small" onClick={() => setShowAddSet(false)}>Close</button>
            </div>
            <div className="modal-body">
              <div className="form-grid">
                <div className="form-label">Set Name</div>
                <input value={newSet.name} onChange={e => setNewSet(s => ({ ...s, name: e.target.value }))} placeholder="e.g., Phantasmal Flames" />

                <div className="form-label">Cards</div>
                <input type="number" value={newSet.cards} onChange={e => setNewSet(s => ({ ...s, cards: e.target.value }))} placeholder="0" />

                <div className="form-label">Total Cards</div>
                <input type="number" value={newSet.totalCards} onChange={e => setNewSet(s => ({ ...s, totalCards: e.target.value }))} placeholder="0" />

                <div className="form-label">Image Link</div>
                <input value={newSet.image} onChange={e => setNewSet(s => ({ ...s, image: e.target.value }))} placeholder="https://…" />

                <div className="form-label">Flags</div>
                <div className="switch-row">
                  <div className="toggle-row">
                    <label className="switch">
                      <input type="checkbox" checked={newSet.canCards} onChange={e => setNewSet(s => ({ ...s, canCards: e.target.checked }))} />
                      <span className="slider"></span>
                    </label>
                    <span className="small">Can Import Cards</span>
                  </div>
                  <div className="toggle-row">
                    <label className="switch">
                      <input type="checkbox" checked={newSet.canSealed} onChange={e => setNewSet(s => ({ ...s, canSealed: e.target.checked }))} />
                      <span className="slider"></span>
                    </label>
                    <span className="small">Can Import Sealed</span>
                  </div>
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn secondary" onClick={() => setShowAddSet(false)}>Cancel</button>
              <button className="btn" onClick={async () => {
                const name = String(newSet.name || '').trim();
                if (!selection.lang || !selection.cat) { alert('Select language and category first.'); return; }
                if (!name) { alert('Enter set name.'); return; }
                try {
                  const ref = doc(db, 'Pokemon Packs', selection.lang, selection.cat, name);
                  await setDoc(ref, {
                    'Cards': Number.parseInt(String(newSet.cards || '').trim(), 10) || 0,
                    'Total Cards': Number.parseInt(String(newSet.totalCards || '').trim(), 10) || 0,
                    'image': String(newSet.image || ''),
                    'CanImportCards': !!newSet.canCards,
                    'CanImportSealed': !!newSet.canSealed
                  }, { merge: true });
                  // Initialize children
                  await setDoc(doc(db, 'Pokemon Packs', selection.lang, selection.cat, name, 'Cards', '_init'), { placeholder: true }, { merge: true });
                  await setDoc(doc(db, 'Pokemon Packs', selection.lang, selection.cat, name, 'Sealed', '_init'), { placeholder: true }, { merge: true });
                  setShowAddSet(false);
                  setNewSet({ name: '', cards: '', totalCards: '', image: '', canCards: false, canSealed: false });
                  // Refresh tabs by mutating structure
                  const structCopy = { ...structure };
                  structCopy[selection.lang] = structCopy[selection.lang] || {};
                  structCopy[selection.lang][selection.cat] = structCopy[selection.lang][selection.cat] || {};
                  structCopy[selection.lang][selection.cat][name] = { hasCards: true, hasSealed: true };
                  setStructure(structCopy);
                  setSelection(s => ({ ...s, setName: name }));
                } catch (e) {
                  alert('Create failed: ' + (e && e.message ? e.message : String(e)));
                }
              }}>Create</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}



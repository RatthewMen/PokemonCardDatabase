import React, { useEffect, useMemo, useState } from 'react';
import Chart from 'react-apexcharts';
import { firebaseApp } from '../firebase.js';
import {
  getFirestore,
  collectionGroup,
  getDocs,
  query,
  orderBy,
  collection,
  where
} from 'firebase/firestore';

const STATS_RANGE_MS = {
  '1H': 60 * 60 * 1000,
  '1D': 24 * 60 * 60 * 1000,
  '7D': 7 * 24 * 60 * 60 * 1000,
  '1M': 30 * 24 * 60 * 60 * 1000,
  '6M': 182 * 24 * 60 * 60 * 1000,
  '1Y': 365 * 24 * 60 * 60 * 1000,
  'ALL': Number.POSITIVE_INFINITY
};

function toMillis(ts) {
  try {
    if (!ts) return 0;
    if (typeof ts.toDate === 'function') return ts.toDate().getTime();
    if (typeof ts === 'number') return ts > 1e12 ? ts : ts * 1000;
    const d = new Date(ts);
    return Number.isNaN(d.getTime()) ? 0 : d.getTime();
  } catch { return 0; }
}
function formatCurrency(n) {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n) || 0);
  } catch {
    return '$' + (Number(n).toFixed ? Number(n).toFixed(2) : String(n));
  }
}
function pickBucketSizeMs(rangeMs) {
  if (!Number.isFinite(rangeMs) || rangeMs === Number.POSITIVE_INFINITY) return 24 * 60 * 60 * 1000;
  const targetPoints = 400;
  const rough = Math.ceil(rangeMs / targetPoints);
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  const week = 7 * day;
  if (rough <= minute) return minute;
  if (rough <= 15 * minute) return 15 * minute;
  if (rough <= hour) return hour;
  if (rough <= 6 * hour) return 6 * hour;
  if (rough <= day) return day;
  if (rough <= week) return week;
  return 30 * day;
}

function startOfDay(ms) {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function densifyDailyPoints(points, startMs, endMs) {
  if (!Array.isArray(points) || points.length === 0) return points;
  const sorted = [...points].sort((a, b) => a.x - b.x);
  const day = 24 * 60 * 60 * 1000;
  const startDay = startOfDay(startMs);
  const endDay = startOfDay(endMs);

  const result = [];
  let idx = 0;
  let lastY = (sorted[0] && Number.isFinite(sorted[0].y)) ? sorted[0].y : 0;

  for (let t = startDay; t <= endDay; t += day) {
    while (idx < sorted.length && sorted[idx].x <= t) {
      lastY = sorted[idx].y;
      result.push(sorted[idx]);
      idx++;
    }
    if (result.length === 0 || result[result.length - 1].x !== t) {
      result.push({ x: t, y: lastY });
    }
  }
  while (idx < sorted.length) {
    result.push(sorted[idx++]);
  }

  // Deduplicate by x (keep first occurrence)
  const seen = new Set();
  const dedup = [];
  for (const p of result) {
    if (!seen.has(p.x)) {
      seen.add(p.x);
      dedup.push(p);
    }
  }
  return dedup.sort((a, b) => a.x - b.x);
}

export default function Statistics() {
  const db = useMemo(() => getFirestore(firebaseApp), []);
  const [range, setRange] = useState('1M');
  const [points, setPoints] = useState([]);
  const [xBounds, setXBounds] = useState([Date.now() - STATS_RANGE_MS['1M'], Date.now()]);
  const [totalNow, setTotalNow] = useState(0);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        // Build cost maps and totalNow
        const cardMap = new Map();
        const sealedMap = new Map();
        let total = 0;
        const cardsSnap = await getDocs(collectionGroup(db, 'Cards'));
        cardsSnap.forEach(docSnap => {
          const data = docSnap.data() || {};
          const parts = docSnap.ref.path.split('/');
          if (parts.length >= 6 && parts[0] === 'Pokemon Packs') {
            const cat = parts[2];
            const setName = parts[3];
            const number = Number(data['Number'] || 0);
            const printing = String(data['Printing'] || '').trim().toLowerCase();
            const key = (cat + ' / ' + setName) + '|' + number + '|' + printing;
            const cost = Number(data['Cost'] || 0) || 0;
            const owned = Number(data['Amount Owned'] || 0) || 0;
            cardMap.set(key, cost);
            if (Number.isFinite(cost) && Number.isFinite(owned)) total += cost * owned;
          }
        });
        const sealedSnap = await getDocs(collectionGroup(db, 'Sealed'));
        sealedSnap.forEach(docSnap => {
          const data = docSnap.data() || {};
          const name = docSnap.id;
          const cost = Number(data['Cost'] || 0) || 0;
          const owned = Number(data['Amount Owned'] || 0) || 0;
          sealedMap.set(name, cost);
          if (Number.isFinite(cost) && Number.isFinite(owned)) total += cost * owned;
        });
        setTotalNow(total);

        // Fetch logs
        const nowMs = Date.now();
        const rangeMs = STATS_RANGE_MS[range];
        const startMs = rangeMs === Number.POSITIVE_INFINITY ? 0 : (nowMs - rangeMs);
        const start = new Date(startMs);
        const now = new Date();
        let cardQ, sealedQ;
        if (Number.isFinite(startMs) && rangeMs !== Number.POSITIVE_INFINITY) {
          cardQ = query(collection(db, 'CardLogs'), where('time', '>=', start), where('time', '<=', now), orderBy('time', 'asc'));
          sealedQ = query(collection(db, 'SealedLogs'), where('time', '>=', start), where('time', '<=', now), orderBy('time', 'asc'));
        } else {
          cardQ = query(collection(db, 'CardLogs'), orderBy('time', 'asc'));
          sealedQ = query(collection(db, 'SealedLogs'), orderBy('time', 'asc'));
        }
        const [cardSnap2, sealedSnap2] = await Promise.all([getDocs(cardQ), getDocs(sealedQ)]);
        const deltas = [];
        if (cardSnap2) {
          cardSnap2.forEach(d => {
            const x = d.data() || {};
            const t = toMillis(x.time);
            if (Array.isArray(x.items)) {
              for (const it of x.items) {
                const key = String(it.set || '') + '|' + Number(it.number || 0) + '|' + String(it.print || '').trim().toLowerCase();
                const cost = cardMap.get(key) || 0;
                const amt = Number(it.amount || 0) || 0;
                if (!Number.isFinite(t)) continue;
                const delta = cost * amt;
                if (delta !== 0) deltas.push({ t, v: delta });
              }
            } else {
              const key = String(x.set || '') + '|' + Number(x.number || 0) + '|' + String(x.print || '').trim().toLowerCase();
              const cost = cardMap.get(key) || 0;
              const amt = Number(x.amount || 0) || 0;
              if (!Number.isFinite(t)) return;
              const delta = cost * amt;
              if (delta !== 0) deltas.push({ t, v: delta });
            }
          });
        }
        if (sealedSnap2) {
          sealedSnap2.forEach(d => {
            const x = d.data() || {};
            const t = toMillis(x.time);
            if (Array.isArray(x.items)) {
              for (const it of x.items) {
                const cost = sealedMap.get(String(it.sealedName || '')) || 0;
                const amt = Number(it.amount || 0) || 0;
                if (!Number.isFinite(t)) continue;
                const delta = cost * amt;
                if (delta !== 0) deltas.push({ t, v: delta });
              }
            } else {
              const cost = sealedMap.get(String(x.sealedName || '')) || 0;
              const amt = Number(x.amount || 0) || 0;
              if (!Number.isFinite(t)) return;
              const delta = cost * amt;
              if (delta !== 0) deltas.push({ t, v: delta });
            }
          });
        }

        // Aggregate
        const rangeStart = rangeMs === Number.POSITIVE_INFINITY ? 0 : startMs;
        const timesMap = new Map();
        for (const d of deltas) {
          if (Number.isFinite(rangeStart) && rangeMs !== Number.POSITIVE_INFINITY && d.t < startMs) continue;
          timesMap.set(d.t, (timesMap.get(d.t) || 0) + d.v);
        }
        const bucketMs = pickBucketSizeMs(nowMs - (rangeMs === Number.POSITIVE_INFINITY ? (deltas.length ? Math.min(...deltas.map(d => d.t)) : nowMs - 365*24*60*60*1000) : startMs));
        const bucketStart = (ms) => Math.floor(ms / bucketMs) * bucketMs;
        const buckets = new Map();
        Array.from(timesMap.entries()).sort((a, b) => a[0] - b[0]).forEach(([t, v]) => {
          const b = bucketStart(t);
          buckets.set(b, (buckets.get(b) || 0) + v);
        });
        const times = Array.from(buckets.keys()).sort((a, b) => a - b);
        // Compute baseline
        const totalDelta = deltas.reduce((s, d) => s + d.v, 0);
        const baseline = Math.max(0, Number.isFinite(totalNow) ? (totalNow - totalDelta) : 0);
        let acc = Math.max(0, baseline);
        const values = times.map(t => {
          acc += buckets.get(t) || 0;
          return Math.max(0, acc);
        });
        const xs = times.length > 0 ? times : [(rangeMs === Number.POSITIVE_INFINITY ? (deltas.length ? Math.min(...deltas.map(d => d.t)) : nowMs - 365*24*60*60*1000) : startMs), nowMs];
        const ys = times.length > 0 ? values : [baseline, totalNow || baseline];

        // Include explicit start and end bounds to stabilize the line
        const startBound = rangeMs === Number.POSITIVE_INFINITY ? xs[0] : startMs;
        const core = xs.map((t, i) => ({ x: t, y: ys[i] }));
        const withBounds = [{ x: startBound, y: baseline }, ...core, { x: nowMs, y: totalNow || baseline }]
          .sort((a, b) => a.x - b.x);

        // Densify with daily points when viewing >= 1 day to reduce visual jitter
        const day = 24 * 60 * 60 * 1000;
        const finalPoints = (rangeMs >= day || rangeMs === Number.POSITIVE_INFINITY)
          ? densifyDailyPoints(withBounds, startBound, nowMs)
          : withBounds;

        setPoints(finalPoints);
        setXBounds([startBound, nowMs]);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [db, range, totalNow]);

  return (
    <div className="card" id="statsCostCard">
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <div className="small muted">Total Collection Cost Over Time</div>
        <div className="tabs small">
          {Object.keys(STATS_RANGE_MS).map(r => (
            <button key={r} className={'tab-btn' + (r === range ? ' active' : '')} onClick={() => setRange(r)}>{r}</button>
          ))}
        </div>
      </div>
      <div style={{ height: 320, width: '100%', overflow: 'hidden' }}>
        {loading ? <div className="small muted">Loading…</div> : (
          <Chart
            type="line"
            height={320}
            series={[{ name: 'Total Cost', data: points }]}
            options={{
              chart: { animations: { enabled: false }, toolbar: { show: false }, parentHeightOffset: 0 },
              stroke: { width: 2, curve: 'straight' },
              dataLabels: { enabled: false },
              xaxis: {
                type: 'datetime',
                min: xBounds[0],
                max: xBounds[1],
                tickAmount: 8,
                crosshairs: { show: false },
                tooltip: { enabled: false }
              },
              yaxis: { min: 0, labels: { formatter: (v) => formatCurrency(v) } },
              grid: { show: true, strokeDashArray: 3 },
              tooltip: {
                x: { formatter: (val) => new Date(val).toLocaleString() },
                y: { formatter: (val) => formatCurrency(val) },
                shared: false,
                fixed: { enabled: false }
              },
              markers: { size: 2 }
            }}
          />
        )}
      </div>
      <div className="small muted" style={{ marginTop: 6 }}>
        Current total: {formatCurrency(totalNow)} • Points: {points.length}
      </div>
    </div>
  );
}



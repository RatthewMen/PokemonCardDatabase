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
  where,
  limit
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

function startOfHour(ms) {
  const d = new Date(ms);
  d.setMinutes(0, 0, 0);
  return d.getTime();
}

function startOfWeekMonday(ms) {
  const d = new Date(ms);
  const day = d.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
  const diffFromMonday = (day + 6) % 7; // 0 if Monday
  d.setDate(d.getDate() - diffFromMonday);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function startOfMonth(ms) {
  const d = new Date(ms);
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function startOfYear(ms) {
  const d = new Date(ms);
  d.setMonth(0, 1); // Jan 1
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function getAlignedRangeStartMs(range, nowMs) {
  switch (range) {
    case '1H': return startOfHour(nowMs);
    case '1D': return startOfDay(nowMs);
    case '7D': return startOfWeekMonday(nowMs);
    case '1M': return startOfMonth(nowMs);
    case '1Y': return startOfYear(nowMs);
    case 'ALL': return 0;
    default: {
      const ms = STATS_RANGE_MS[range];
      if (!Number.isFinite(ms) || ms === Number.POSITIVE_INFINITY) return 0;
      return nowMs - ms;
    }
  }
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
  const [xBounds, setXBounds] = useState([getAlignedRangeStartMs('1M', Date.now()), Date.now()]);
  const [yBounds, setYBounds] = useState([0, undefined]);
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

        // Determine end bound as the latest data point (fallback to now if none)
        const [latestCardSnap, latestSealedSnap] = await Promise.all([
          getDocs(query(collection(db, 'CardLogs'), orderBy('time', 'desc'), limit(1))),
          getDocs(query(collection(db, 'SealedLogs'), orderBy('time', 'desc'), limit(1)))
        ]);
        let latestCardMs = 0;
        if (latestCardSnap && !latestCardSnap.empty) {
          latestCardSnap.forEach(docSnap => {
            const dt = toMillis((docSnap.data() || {}).time);
            if (Number.isFinite(dt)) latestCardMs = Math.max(latestCardMs, dt);
          });
        }
        let latestSealedMs = 0;
        if (latestSealedSnap && !latestSealedSnap.empty) {
          latestSealedSnap.forEach(docSnap => {
            const dt = toMillis((docSnap.data() || {}).time);
            if (Number.isFinite(dt)) latestSealedMs = Math.max(latestSealedMs, dt);
          });
        }
        const endMs = Math.max(latestCardMs, latestSealedMs, Date.now());
        const rangeMs = STATS_RANGE_MS[range];
        const alignedStartMs = rangeMs === Number.POSITIVE_INFINITY ? 0 : getAlignedRangeStartMs(range, endMs);
        const start = new Date(alignedStartMs);
        const endDate = new Date(endMs);
        let cardQ, sealedQ;
        if (Number.isFinite(alignedStartMs) && rangeMs !== Number.POSITIVE_INFINITY) {
          cardQ = query(collection(db, 'CardLogs'), where('time', '>=', start), where('time', '<=', endDate), orderBy('time', 'asc'));
          sealedQ = query(collection(db, 'SealedLogs'), where('time', '>=', start), where('time', '<=', endDate), orderBy('time', 'asc'));
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
        const rangeStart = rangeMs === Number.POSITIVE_INFINITY ? 0 : alignedStartMs;
        const timesMap = new Map();
        for (const d of deltas) {
          if (Number.isFinite(rangeStart) && rangeMs !== Number.POSITIVE_INFINITY && d.t < alignedStartMs) continue;
          timesMap.set(d.t, (timesMap.get(d.t) || 0) + d.v);
        }
        const bucketMs = pickBucketSizeMs(
          (rangeMs === Number.POSITIVE_INFINITY)
            ? ((deltas.length ? (endMs - Math.min(...deltas.map(d => d.t))) : (365 * 24 * 60 * 60 * 1000)))
            : (endMs - alignedStartMs)
        );
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
        const xs = times.length > 0
          ? times
          : [
              (rangeMs === Number.POSITIVE_INFINITY
                ? (deltas.length ? Math.min(...deltas.map(d => d.t)) : (endMs - 365 * 24 * 60 * 60 * 1000))
                : alignedStartMs),
              endMs
            ];
        const ys = times.length > 0 ? values : [baseline, totalNow || baseline];

        // Include explicit start and end bounds to stabilize the line
        const startBound = rangeMs === Number.POSITIVE_INFINITY ? xs[0] : alignedStartMs;
        const core = xs.map((t, i) => ({ x: t, y: ys[i] }));
        const withBounds = [{ x: startBound, y: baseline }, ...core, { x: endMs, y: totalNow || baseline }]
          .sort((a, b) => a.x - b.x);

        // Densify with daily points when viewing >= 1 day to reduce visual jitter
        const day = 24 * 60 * 60 * 1000;
        const finalPoints = (rangeMs >= day || rangeMs === Number.POSITIVE_INFINITY)
          ? densifyDailyPoints(withBounds, startBound, endMs)
          : withBounds;

        setPoints(finalPoints);
        setXBounds([startBound, endMs]);
        // Compute dynamic y-axis bounds with padding
        const inView = finalPoints.filter(p => p.x >= startBound && p.x <= endMs);
        const yValsInView = inView.length ? inView.map(p => Number(p.y) || 0) : [0, Number(totalNow) || 0];
        let yMin = Math.min(...yValsInView);
        let yMax = Math.max(...yValsInView);
        if (!Number.isFinite(yMin)) yMin = 0;
        if (!Number.isFinite(yMax)) yMax = Number(totalNow) || 0;
        // Ensure non-zero span
        const span = Math.max(1e-6, yMax - yMin);
        const pad = Math.max(span * 0.05, 1); // 5% or at least 1
        const minWithPad = Math.max(0, yMin - pad);
        const maxWithPad = yMax + pad;
        setYBounds([minWithPad, maxWithPad]);
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
              yaxis: {
                min: yBounds[0],
                max: yBounds[1],
                labels: { formatter: (v) => formatCurrency(v) }
              },
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



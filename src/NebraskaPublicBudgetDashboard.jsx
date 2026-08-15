import React, { useMemo, useState, useEffect, useCallback } from 'react';
import {
  AlertTriangle, ArrowDownRight, ArrowUpRight, BookOpen, Building2, Clock,
  Database, Download, FileText, Ghost, HelpCircle, Landmark, PieChart,
  Scale, Search, TrendingUp, X,
} from 'lucide-react';
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell,
  ResponsiveContainer, Tooltip as ReTooltip,
  XAxis, YAxis,
} from 'recharts';

/* ═══════════════════ PALETTE ═══════════════════ */

const C = {
  navy: '#0F2440', navyMid: '#1A3A5C', navyLight: '#264E78',
  gold: '#C9A84C', goldLight: '#E8D59A', goldDim: 'rgba(201,168,76,.10)',
  emerald: '#10B981', emeraldDim: 'rgba(16,185,129,.08)',
  red: '#EF4444', redDim: 'rgba(239,68,68,.08)',
  amber: '#F59E0B', amberDim: 'rgba(245,158,11,.08)',
  blue: '#3B82F6', blueDim: '#EFF6FF',
  s50: '#F8FAFC', s100: '#F1F5F9', s200: '#E2E8F0', s300: '#CBD5E1',
  s400: '#94A3B8', s500: '#64748B', s700: '#334155', s800: '#1E293B', s900: '#0F172A',
};

const card = { background: '#fff', borderRadius: 14, border: `1px solid ${C.s200}`, overflow: 'hidden' };
const panel = { ...card, padding: 22 };

const TABS = [
  { id: 'overview', icon: PieChart, label: 'Overview' },
  { id: 'revenue', icon: TrendingUp, label: 'Revenue' },
  { id: 'gfstatus', icon: Scale, label: 'GF Status' },
  { id: 'agencies', icon: Building2, label: 'Agencies' },
  { id: 'review', icon: Search, label: 'Fund Review' },
  { id: 'funds', icon: Database, label: 'Fund Explorer' },
  { id: 'reference', icon: BookOpen, label: 'Reference' },
];

const NE_POP_FALLBACK = 2018006;
const DATA_URL = `${import.meta.env.BASE_URL}dashboard_data.json`;
const LEGACY_DATA_URL = 'https://script.google.com/macros/s/AKfycbxdhapah1CYnlo6GBH3vpstAxJx8JRzxenkDc45t_4qa5W306HY1m_Ft841nwHJs_x1/exec';

/* ═══════════════════ FORMATTERS ═══════════════════ */

function fmt(v) { if (v == null || isNaN(v)) return '$0'; return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(Number(v)); }
function fmtC(v) { if (v == null || isNaN(v)) return '$0'; const n = Number(v), a = Math.abs(n); if (a >= 1e9) return `$${(n / 1e9).toFixed(2)}B`; if (a >= 1e6) return `$${(n / 1e6).toFixed(1)}M`; if (a >= 1e3) return `$${(n / 1e3).toFixed(0)}K`; return fmt(n); }
function fmtP(d) { return isNaN(d) ? '0%' : `${(d * 100).toFixed(1)}%`; }
function getCat(id) { return { 1: 'General', 2: 'Cash', 3: 'Construction', 4: 'Federal', 5: 'Revolving', 6: 'Trust', 7: 'Distributive', 8: 'Suspense' }[String(id || '').charAt(0)] || 'Unknown'; }
function cleanLabel(value) { return String(value || '').replace(/^\s*[–—-]\s*/, '').trim(); }

/* ═══════════════════ ERROR BOUNDARY ═══════════════════ */

class ErrorBoundary extends React.Component {
  constructor(p) { super(p); this.state = { err: null }; }
  static getDerivedStateFromError(err) { return { err }; }
  componentDidCatch(err, info) { console.error('Tab crashed:', err, info); }
  render() {
    if (this.state.err) {
      return (
        <div style={{ ...panel, borderLeft: `4px solid ${C.red}`, background: C.redDim }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
            <AlertTriangle style={{ width: 18, height: 18, color: '#DC2626', marginTop: 2, flexShrink: 0 }} />
            <div style={{ fontSize: 13, color: '#7F1D1D', lineHeight: 1.7 }}>
              <strong>This section couldn't render.</strong> The live data may be missing a field this view expects.
              <pre style={{ marginTop: 8, fontSize: 11, background: '#fff', padding: 8, borderRadius: 6, overflow: 'auto', color: C.s700 }}>
                {String(this.state.err?.message || this.state.err)}
              </pre>
              <button type="button" onClick={() => this.setState({ err: null })} style={{ marginTop: 8, border: 'none', background: C.red, color: '#fff', borderRadius: 6, padding: '6px 12px', cursor: 'pointer', fontWeight: 600, fontSize: 12 }}>Try again</button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

/* ═══════════════════ CSV ═══════════════════ */

function downloadCsv(filename, headers, rows) {
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = [headers.join(','), ...rows.map((r) => r.map(esc).join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 100);
}

/* ═══════════════════ NORMALIZE (FIXED) ═══════════════════ */

function normalizeData(raw) {
  const safe = raw || {};
  const fd = safe.fundDescriptions || {};
  const seen = new Map();

  // Pass 1: active funds from OIP
  (safe.funds || []).forEach((f) => {
    const id = String(f.id);
    const history = (f.history || []).map((point) => {
      const balance = Number(point.balance ?? (Number(point.b || 0) * 1e6)) || 0;
      const label = point.label || point.m || point.period || '';
      return { ...point, label, m: label, balance, b: balance / 1e6, interest: Number(point.interest ?? 0) || 0 };
    });
    const calculatedDelta = history.length > 1 ? history[history.length - 1].balance - history[history.length - 2].balance : 0;
    seen.set(id, {
      id, title: cleanLabel(f.title) || `Fund ${id}`,
      balance: Number(f.balance ?? 0) || 0, interest: Number(f.interest ?? 0) || 0,
      delta: Number(f.delta ?? calculatedDelta) || 0, approp: Number(f.approp ?? 0) || 0, expended: Number(f.expended ?? 0) || 0,
      description: f.description || '', statutory_authority: f.statutory_authority || '',
      agency_name: cleanLabel(f.agency_name), program: f.program || '',
      history, ending_balance: f.ending_balance ?? null,
      category: getCat(id), dormant: false, hasOipEntry: f.hasOipEntry !== false,
    });
  });

  // Pass 2: merge LFO descriptions
  Object.entries(fd).forEach(([id, desc]) => {
    const sId = String(id);
    if (seen.has(sId)) {
      const existing = seen.get(sId);
      // ALWAYS overwrite the generic OIP title with the rich LFO title
      if (desc.title) existing.title = cleanLabel(desc.title);
      if (!existing.description && desc.description) existing.description = desc.description;
      if (!existing.statutory_authority && desc.statutory_authority) existing.statutory_authority = desc.statutory_authority;
      if (!existing.agency_name && desc.agency_name) existing.agency_name = cleanLabel(desc.agency_name);
      if (!existing.program && desc.program) existing.program = desc.program;
      if (existing.ending_balance == null && desc.ending_balance != null) existing.ending_balance = desc.ending_balance;
    } else {
      // Directory-only record. Absence from OIP does not establish inactivity.
      seen.set(sId, {
        id: sId, title: cleanLabel(desc.title) || `Fund ${sId}`,
        balance: 0, interest: 0, delta: 0, approp: 0, expended: 0,
        description: desc.description || '', statutory_authority: desc.statutory_authority || '',
        agency_name: cleanLabel(desc.agency_name), program: desc.program || '',
        history: [], ending_balance: desc.ending_balance ?? null,
        category: getCat(sId), dormant: true, hasOipEntry: false,
      });
    }
  });

  const funds = [...seen.values()].sort((a, b) => a.dormant !== b.dormant ? (a.dormant ? 1 : -1) : b.balance - a.balance);

  const rs = safe.revenue || {};
  const revenue = {
    period: rs.period || '', nefabBasis: rs.nefabBasis || safe.lastUpdated?.nefab || '',
    ytdActual: Number(rs.ytdActual ?? 0) || 0, ytdForecast: Number(rs.ytdForecast ?? 0) || 0,
    categories: (rs.categories || []).map((c) => ({ name: c.name || '', actual: Number(c.actual ?? 0) || 0, forecast: Number(c.forecast ?? 0) || 0 })),
    nefabForecasts: rs.nefabForecasts || [],
    monthlySeries: (rs.monthlySeries || []).map((m) => ({
      month: m.month,
      actual: m.actual == null ? null : Number(m.actual) || 0,
      forecast: Number(m.forecast ?? 0) || 0,
    })),
  };

  // Defensive defaults for GF Status and related structures
  const oldStatus = safe.generalFundStatus || {};
  const generalFundStatus = {
    fiscalYear: oldStatus.fiscalYear || 'FY2025-26',
    beginningBalance: Number(oldStatus.beginningBalance ?? oldStatus.beginningBalance_FY2526 ?? 0) || 0,
    netRevenues: Number(oldStatus.netRevenues ?? oldStatus.netRevenues_FY2526 ?? 0) || 0,
    appropriations: Number(oldStatus.appropriations ?? oldStatus.appropriations_FY2526 ?? 0) || 0,
    endingBalance: Number(oldStatus.endingBalance ?? oldStatus.endingBalance_FY2526 ?? 0) || 0,
    minimumReserveVariance: Number(oldStatus.minimumReserveVariance ?? oldStatus.minimumReserve_variance ?? 0) || 0,
    followingBienniumVariance: Number(oldStatus.followingBienniumVariance ?? oldStatus.minimumReserve_variance_2829 ?? 0) || 0,
    cashReserveProjectedEndingBalance: Number(oldStatus.cashReserveProjectedEndingBalance ?? 0) || 0,
    cashReserveOipAverageDailyBalance: Number(oldStatus.cashReserveOipAverageDailyBalance ?? oldStatus.cashReserve_endingBalance ?? 0) || 0,
    ...oldStatus,
  };

  return {
    ...safe, funds, revenue, generalFundStatus,
    gfStatusTable: safe.gfStatusTable || [], gfStatusYears: safe.gfStatusYears || [],
    cashReserveHistory: safe.cashReserveHistory || [],
    transfersOutHistory: safe.transfersOutHistory || [],
    gfTransfers: safe.gfTransfers || [],
    agencies: safe.agencies || [],
    lastUpdated: safe.lastUpdated || {}, sources: safe.sources || {}, warnings: safe.warnings || [],
    population: safe.population || { value: NE_POP_FALLBACK, asOf: 'July 1, 2025 estimate' },
    macro: {
      totalBalance: safe.macro?.totalBalance || 0, totalInterest: safe.macro?.totalInterest || 0,
      effectiveYield: safe.macro?.effectiveYield || 'N/A', activeFunds: safe.macro?.activeFunds || 0,
      dormantFunds: funds.filter((f) => f.dormant).length,
      referenceOnlyFunds: funds.filter((f) => f.dormant).length,
      totalFunds: funds.length,
    },
  };
}

/* ═══════════════════ SHARED ═══════════════════ */

function Badge({ text, color = C.navy, bg = C.goldDim }) { return <span style={{ display: 'inline-flex', alignItems: 'center', padding: '2px 10px', borderRadius: 999, fontSize: 10, fontWeight: 700, color, background: bg, letterSpacing: 0.4 }}>{text}</span>; }
function Delta({ value, compact }) {
  if (!value || isNaN(value) || Number(value) === 0) return null;
  const n = Number(value), p = n > 0, I = p ? ArrowUpRight : ArrowDownRight;
  return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '3px 8px', borderRadius: 999, fontSize: 11, fontWeight: 700, color: p ? '#059669' : '#DC2626', background: p ? C.emeraldDim : C.redDim }}><I style={{ width: 12, height: 12 }} />{compact ? fmtC(Math.abs(n)) : fmt(Math.abs(n))}</span>;
}
function InfoTip({ label, body }) {
  const [open, setOpen] = useState(false);
  return <span style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', gap: 4 }}><button type="button" aria-label={typeof label === 'string' ? label : 'Info'} onFocus={() => setOpen(true)} onBlur={() => setOpen(false)} onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, border: 'none', background: 'transparent', padding: 0, cursor: 'help', color: 'inherit' }}><span style={{ borderBottom: `1px dashed ${C.s400}` }}>{label}</span><HelpCircle style={{ width: 12, height: 12, opacity: 0.6 }} /></button>{open && <span style={{ position: 'absolute', left: 0, bottom: 'calc(100% + 8px)', width: 280, background: C.s900, color: '#fff', borderRadius: 10, padding: '10px 12px', fontSize: 11.5, lineHeight: 1.6, zIndex: 20, boxShadow: '0 10px 30px rgba(0,0,0,.22)' }}>{body}</span>}</span>;
}
function Spark({ data, positive }) {
  if (!data || data.length < 2) return null;
  const vals = data.map((d) => d.b), mn = Math.min(...vals), mx = Math.max(...vals), rng = mx - mn || 1, w = 70, h = 22;
  const pts = vals.map((v, i) => `${(i / (vals.length - 1)) * w},${h - ((v - mn) / rng) * (h - 4) - 2}`).join(' ');
  return <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ display: 'block' }}><polyline points={pts} fill="none" stroke={positive == null ? C.navy : positive ? C.emerald : C.red} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}
function PBar({ pct, color = C.navy, height = 8, label }) {
  const cp = Math.min(pct, 1);
  return <div><div style={{ height, background: C.s100, borderRadius: height, overflow: 'hidden' }}><div style={{ height: '100%', width: `${cp * 100}%`, background: color, borderRadius: height, transition: 'width 1s cubic-bezier(.4,0,.2,1)' }} /></div>{label && <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 3, fontSize: 10.5, color: C.s500 }}><span>{fmtP(pct)}</span><span>{label}</span></div>}</div>;
}
function MetricCard({ label, value, sub }) { return <div style={panel}><div style={{ fontSize: 11, color: C.s500, textTransform: 'uppercase', letterSpacing: 1.2 }}>{label}</div><div style={{ fontSize: 28, fontWeight: 900, color: C.navy, marginTop: 6 }}>{value}</div>{sub && <div style={{ marginTop: 8 }}>{sub}</div>}</div>; }
function ExportBtn({ onClick }) { return <button type="button" onClick={onClick} aria-label="Export CSV" style={{ border: `1px solid ${C.s300}`, background: '#fff', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, color: C.s500, fontWeight: 600 }}><Download style={{ width: 12, height: 12 }} />CSV</button>; }
function Narrative({ children }) { return <div style={{ fontSize: 14, color: C.s700, lineHeight: 1.8, marginBottom: 20 }}>{children}</div>; }
function useDebounce(value, delay = 150) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => { const t = setTimeout(() => setDebounced(value), delay); return () => clearTimeout(t); }, [value, delay]);
  return debounced;
}

/* ═══════════════════ WATERFALL ═══════════════════ */

function WaterfallChart({ beginBal, revenues, transfers, appropriations, endBal }) {
  const steps = [
    { name: 'Beginning\nBalance', val: beginBal, color: C.navy, sign: 1 },
    { name: 'Net\nRevenues', val: revenues, color: C.emerald, sign: 1 },
    { name: 'Transfers\nOut', val: transfers, color: C.amber, sign: -1 },
    { name: 'Approp-\nriations', val: appropriations, color: C.red, sign: -1 },
    { name: 'Ending\nBalance', val: endBal, color: endBal >= 0 ? C.navy : C.red, sign: endBal >= 0 ? 1 : -1 },
  ];

  const data = steps.map((s) => ({
    name: s.name,
    value: Math.abs(Number(s.val) || 0) / 1e9,
    color: s.color,
    sign: s.sign,
  }));

  const MultiLineTick = ({ x, y, payload }) => {
    const lines = String(payload.value).split('\n');
    return (
      <g transform={`translate(${x},${y + 10})`}>
        {lines.map((line, i) => (
          <text key={i} x={0} y={i * 12} textAnchor="middle" fill={C.s500} fontSize={10}>{line}</text>
        ))}
      </g>
    );
  };

  return (
    <div style={{ height: 280 }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} barSize={50} margin={{ top: 10, right: 10, left: 0, bottom: 30 }}>
          <CartesianGrid vertical={false} strokeDasharray="3 3" stroke={C.s200} />
          <XAxis dataKey="name" tick={<MultiLineTick />} axisLine={false} tickLine={false} interval={0} height={40} />
          <YAxis tick={{ fill: C.s500, fontSize: 10 }} axisLine={false} tickLine={false} width={50} tickFormatter={(v) => `$${v.toFixed(1)}B`} />
          <ReTooltip
            formatter={(v, name, props) => {
              const sign = props?.payload?.sign === -1 ? '-' : '+';
              return [`${sign}$${Number(v).toFixed(2)}B`, 'Amount'];
            }}
          />
          <Bar dataKey="value" radius={[4, 4, 0, 0]}>
            {data.map((d, i) => <Cell key={i} fill={d.color} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <div style={{ marginTop: 12, fontSize: 11.5, color: C.s500, lineHeight: 1.6, textAlign: 'center' }}>
        <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: C.emerald, marginRight: 4, verticalAlign: 'middle' }} /> Inflows&nbsp;&nbsp;
        <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: C.red, marginRight: 4, marginLeft: 10, verticalAlign: 'middle' }} /> Outflows&nbsp;&nbsp;
        <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: C.navy, marginRight: 4, marginLeft: 10, verticalAlign: 'middle' }} /> Balance points
      </div>
    </div>
  );
}

/* ═══════════════════ OVERVIEW ═══════════════════ */

function OverviewTab({ data, onNav }) {
  const featured = data.funds.filter((f) => !f.dormant).slice(0, 3);
  const gainers = data.funds.filter((f) => f.delta > 0).sort((a, b) => b.delta - a.delta).slice(0, 4);
  const losers = data.funds.filter((f) => f.delta < 0).sort((a, b) => a.delta - b.delta).slice(0, 4);
  const stalled = data.funds.filter((f) => f.approp > 10000000 && f.expended > 0 && f.expended / f.approp < 0.1);
  const gfs = data.generalFundStatus;

  return <div style={{ display: 'grid', gap: 18 }}>
    <Narrative>
      The latest Operating Investment Pool report contains <strong>{fmtC(data.macro.totalBalance)}</strong> in average daily balances across {data.macro.reportedFunds || data.macro.activeFunds || data.funds.length} reported funds.
      {gfs.endingBalance !== 0 && <> The official General Fund status projects a {gfs.endingBalance >= 0 ? 'positive' : 'negative'} {gfs.fiscalYear} ending balance of <strong>{fmtC(Math.abs(gfs.endingBalance))}</strong>.</>}
    </Narrative>

    <div style={{ ...card, background: `linear-gradient(135deg, ${C.navy}, ${C.navyMid}, ${C.navyLight})`, color: '#fff', padding: 26 }}>
      <div style={{ fontSize: 11, color: C.goldLight, textTransform: 'uppercase', letterSpacing: 1.8 }}><InfoTip label="Statewide OIP position" body="Sum of average daily balances reported in the latest DAS Operating Investment Pool report. Directory-only records are shown separately for reference." /></div>
      <div style={{ fontSize: 42, fontWeight: 900, marginTop: 8 }}>{fmtC(data.macro.totalBalance)}</div>
      <div className="metric-grid" style={{ marginTop: 20 }}>
        {[{ l: 'Allocated interest', v: fmt(Math.abs(data.macro.totalInterest)) }, { l: 'Published rate', v: data.macro.effectiveYield }, { l: 'Nonzero balances', v: data.macro.activeFunds }, { l: 'Reference-only', v: data.macro.referenceOnlyFunds }].map((s) => <div key={s.l}><div style={{ fontSize: 11, color: 'rgba(255,255,255,.6)', textTransform: 'uppercase', letterSpacing: 1.3 }}>{s.l}</div><div style={{ fontSize: 20, fontWeight: 800, marginTop: 3 }}>{s.v}</div></div>)}
      </div>
    </div>

    {(gainers.length > 0 || losers.length > 0) && <div style={{ ...panel, borderLeft: `4px solid ${C.gold}` }}>
      <div style={{ fontWeight: 800, color: C.navy, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}><Clock style={{ width: 16, height: 16 }} /> What changed this month</div>
      <div className="two-col">{[{ label: 'Largest gains', items: gainers }, { label: 'Largest drawdowns', items: losers }].map((sec) => <div key={sec.label}><div style={{ fontSize: 11, color: C.s500, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>{sec.label}</div>{sec.items.map((f) => <div key={f.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: `1px solid ${C.s100}` }}><div><span style={{ fontSize: 12.5, fontWeight: 600 }}>{f.title}</span><span style={{ fontSize: 10.5, color: C.s400, marginLeft: 6 }}>#{f.id}</span></div><Delta value={f.delta} compact /></div>)}</div>)}</div>
    </div>}

    {stalled.length > 0 && <div style={{ ...panel, borderLeft: `4px solid ${C.red}`, background: C.redDim }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <AlertTriangle style={{ width: 18, height: 18, color: '#DC2626', marginTop: 2, flexShrink: 0 }} />
        <div style={{ fontSize: 13, color: '#7F1D1D', lineHeight: 1.7 }}>
          <strong>Stalled appropriations:</strong> {stalled.map((f, i) => <span key={f.id}>{i > 0 && ', '}<button type="button" onClick={() => onNav('funds', f.id)} style={{ font: 'inherit', border: 'none', background: 'none', color: '#991B1B', cursor: 'pointer', textDecoration: 'underline', padding: 0 }}>{f.title}</button> ({fmtP(f.expended / f.approp)} of {fmtC(f.approp)} spent)</span>)}. Funds with over $10M appropriated and less than 10% disbursed.
        </div>
      </div>
    </div>}

    <div className="metric-grid">
      <MetricCard label={`${gfs.fiscalYear} GF ending balance`} value={fmtC(gfs.endingBalance)} sub={<Delta value={gfs.endingBalance - gfs.beginningBalance} compact />} />
      <MetricCard label="Cash Reserve OIP ADB" value={fmtC(gfs.cashReserveOipAverageDailyBalance)} />
      <MetricCard label="Statutory reserve variance" value={fmtC(gfs.minimumReserveVariance)} sub={gfs.minimumReserveVariance < 0 ? <Badge text="Below target" color="#991B1B" bg="rgba(239,68,68,.12)" /> : <Badge text="Above target" color="#047857" bg="rgba(16,185,129,.12)" />} />
      <MetricCard label={`${gfs.fiscalYear} GF net revenues`} value={fmtC(gfs.netRevenues)} />
    </div>

    <div className="three-col">{featured.map((f) => <button key={f.id} type="button" onClick={() => onNav('funds', f.id)} style={{ ...panel, textAlign: 'left', cursor: 'pointer', borderLeft: `4px solid ${f.delta >= 0 ? C.emerald : C.red}` }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}><div><div style={{ fontSize: 11, color: C.s500, textTransform: 'uppercase', letterSpacing: 1.2 }}>Fund {f.id}</div><div style={{ fontSize: 15, fontWeight: 800, color: C.navy, marginTop: 5 }}>{f.title}</div></div><Spark data={f.history} positive={f.delta >= 0} /></div>
      <div style={{ fontSize: 25, fontWeight: 900, marginTop: 10 }}>{fmtC(f.balance)}</div>
      <div style={{ marginTop: 8 }}><Delta value={f.delta} compact /></div>
      {f.approp > 0 && <div style={{ marginTop: 12 }}><PBar pct={f.expended / f.approp} color={C.navyLight} height={5} label={`${fmtP(f.expended / f.approp)} of ${fmtC(f.approp)} appropriated`} /></div>}
    </button>)}</div>

    {data.macro.referenceOnlyFunds > 0 && <div style={{ ...panel, borderLeft: `4px solid ${C.amber}`, background: C.amberDim }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}><FileText style={{ width: 18, height: 18, color: '#D97706', marginTop: 2, flexShrink: 0 }} /><div style={{ fontSize: 13, color: '#92400E', lineHeight: 1.7 }}><strong>{data.macro.referenceOnlyFunds} directory-only fund records</strong> do not have an entry in the latest OIP report. That does not establish that a fund is inactive, abolished, or eligible for transfer. <button type="button" onClick={() => onNav('funds', null, true)} style={{ font: 'inherit', background: 'none', border: 'none', color: '#B45309', cursor: 'pointer', textDecoration: 'underline', padding: 0 }}>View reference-only records →</button></div></div>
    </div>}
  </div>;
}

/* ═══════════════════ REVENUE ═══════════════════ */

function RevenueTab({ revenue }) {
  const v = revenue.ytdActual - revenue.ytdForecast;
  const forecastYears = [...new Set(revenue.nefabForecasts.flatMap((row) => Object.keys(row.values || {})))];
  if (revenue.ytdActual === 0 && revenue.monthlySeries.length === 0) return <div style={panel}>No revenue data yet.</div>;

  return <div style={{ display: 'grid', gap: 18 }}>
    <Narrative>
      Year-to-date General Fund receipts are <strong>{fmtC(revenue.ytdActual)}</strong>, running {v >= 0 ? `${fmtC(v)} above` : `${fmtC(Math.abs(v))} below`} the NEFAB certified forecast.
      {revenue.nefabBasis && <> The current comparison uses the <strong>{revenue.nefabBasis}</strong> forecast.</>}
    </Narrative>

    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 12 }}>
      <div><div style={{ fontSize: 20, fontWeight: 900, color: C.navy }}>General Fund Net Receipts</div></div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        {revenue.nefabBasis && <Badge text={`NEFAB: ${revenue.nefabBasis}`} color={C.navyMid} bg={C.goldDim} />}
        {revenue.monthlySeries.length > 0 && <ExportBtn onClick={() => downloadCsv('ne_revenue_monthly.csv', ['Month', 'Actual', 'Forecast'], revenue.monthlySeries.map((m) => [m.month, m.actual, m.forecast]))} />}
      </div>
    </div>

    <div style={{ display: 'grid', gap: 14, gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
      <MetricCard label="YTD actual" value={fmtC(revenue.ytdActual)} sub={<Delta value={v} compact />} />
      <MetricCard label="YTD forecast" value={fmtC(revenue.ytdForecast)} />
      <MetricCard label="Report period" value={revenue.period || 'Unknown'} />
    </div>

    {revenue.monthlySeries.length > 0 && <div className="two-col">
      <div style={panel}>
        <div style={{ fontWeight: 800, color: C.navy, marginBottom: 14 }}>Monthly net receipts vs. forecast</div>
        <div style={{ height: 260 }}><ResponsiveContainer width="100%" height="100%"><BarChart data={revenue.monthlySeries} barGap={4}>
          <CartesianGrid vertical={false} strokeDasharray="3 3" stroke={C.s200} />
          <XAxis dataKey="month" tick={{ fill: C.s500, fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={(m) => String(m).slice(0, 3)} />
          <YAxis tick={{ fill: C.s500, fontSize: 11 }} axisLine={false} tickLine={false} width={48} tickFormatter={(v) => `$${Math.round(v / 1e6)}M`} />
          <ReTooltip formatter={(v) => fmt(v)} />
          <Bar dataKey="forecast" fill={C.s200} radius={[4, 4, 0, 0]} name="Forecast" />
          <Bar dataKey="actual" radius={[4, 4, 0, 0]} name="Actual">{revenue.monthlySeries.map((d, i) => <Cell key={i} fill={d.actual == null ? 'transparent' : d.actual >= d.forecast ? C.emerald : C.amber} />)}</Bar>
        </BarChart></ResponsiveContainer></div>
      </div>
      {revenue.categories.length > 0 && <div style={panel}>
        <div style={{ fontWeight: 800, color: C.navy, marginBottom: 14 }}>YTD category comparison</div>
        <div style={{ display: 'grid', gap: 12 }}>{revenue.categories.map((c) => {
          const cv = c.actual - c.forecast, pct = c.forecast > 0 ? c.actual / c.forecast : 0;
          return <div key={c.name} style={{ borderBottom: `1px solid ${C.s100}`, paddingBottom: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}><div style={{ fontWeight: 700, color: C.s800 }}>{c.name}</div><Delta value={cv} compact /></div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: C.s500, marginBottom: 8 }}><span>Actual: {fmtC(c.actual)}</span><span>Forecast: {fmtC(c.forecast)}</span></div>
            <PBar pct={pct} color={c.actual >= c.forecast ? C.emerald : C.amber} height={6} />
          </div>;
        })}</div>
      </div>}
    </div>}

    {revenue.nefabForecasts.length > 0 && <div style={panel}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <div><div style={{ fontWeight: 800, color: C.navy }}>NEFAB full-year forecasts</div></div>
        <ExportBtn onClick={() => downloadCsv('ne_nefab_forecasts.csv', ['Category', ...forecastYears], revenue.nefabForecasts.map((c) => [c.name, ...forecastYears.map((fy) => c.values?.[fy])]))} />
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead><tr style={{ borderBottom: `2px solid ${C.s200}` }}>{['Category', ...forecastYears].map((h) => <th key={h} style={{ textAlign: h === 'Category' ? 'left' : 'right', padding: '8px 0', fontSize: 10, fontWeight: 700, color: C.s400, textTransform: 'uppercase', letterSpacing: 1 }}>{h}</th>)}</tr></thead>
        <tbody>{revenue.nefabForecasts.map((c) => <tr key={c.name} style={{ borderBottom: `1px solid ${C.s100}` }}>
          <td style={{ padding: '10px 0', fontWeight: 600 }}>{c.name}</td>{forecastYears.map((fy) => <td key={fy} style={{ padding: '10px 0', textAlign: 'right' }}>{fmtC(c.values?.[fy])}</td>)}
        </tr>)}</tbody>
      </table>
    </div>}
  </div>;
}

/* ═══════════════════ GF STATUS (HARDENED) ═══════════════════ */

function GFStatusTab({ data }) {
  const st = data.generalFundStatus || {};
  const table = data.gfStatusTable || [];
  const years = data.gfStatusYears?.length ? data.gfStatusYears : [...new Set(table.flatMap((row) => Object.keys(row.values || {})))];
  const transfersRow = table.find((row) => String(row.label || '').includes('Transfers'));
  const currentTransfers = transfersRow?.values?.[st.fiscalYear] || 0;
  const reserveColor = st.minimumReserveVariance < 0 ? C.red : C.emerald;
  const reserveBg = st.minimumReserveVariance < 0 ? C.redDim : C.emeraldDim;

  return <div style={{ display: 'grid', gap: 18 }}>
    <Narrative>
      This is the Legislature's latest official financial-status snapshot, not a live cash ledger. For {st.currentBienniumFiscalYear || 'the current biennium'}, the balance is projected to be <strong>{fmt(Math.abs(st.minimumReserveVariance))} {st.minimumReserveVariance < 0 ? 'below' : 'above'}</strong> the statutory 3% reserve level.
      {st.followingBienniumFiscalYear && <> The projected variance for {st.followingBienniumFiscalYear} is <strong>{fmt(st.followingBienniumVariance)}</strong>.</>}
    </Narrative>

    <div style={{ ...panel, borderLeft: `4px solid ${reserveColor}`, background: reserveBg }}>
      <div style={{ fontSize: 13, color: st.minimumReserveVariance < 0 ? '#7F1D1D' : '#065F46', lineHeight: 1.7 }}>
        <strong>{st.currentBienniumFiscalYear || 'Current biennium'}:</strong> {fmt(Math.abs(st.minimumReserveVariance))} {st.minimumReserveVariance < 0 ? 'below' : 'above'} the statutory minimum reserve.
      </div>
    </div>

    {(st.beginningBalance || st.netRevenues || st.endingBalance) ? <div style={panel}>
      <div style={{ fontWeight: 800, color: C.navy, marginBottom: 4 }}>{st.fiscalYear} General Fund flow</div>
      <div style={{ fontSize: 12, color: C.s500, marginBottom: 14 }}>Official projected values from the latest General Fund Financial Status table</div>
      <WaterfallChart beginBal={st.beginningBalance} revenues={st.netRevenues} transfers={-Math.abs(currentTransfers)} appropriations={-Math.abs(st.appropriations)} endBal={st.endingBalance} />
    </div> : null}

    <div className="metric-grid">
      <MetricCard label="Projected Cash Reserve ending" value={st.cashReserveProjectedEndingBalance ? fmtC(st.cashReserveProjectedEndingBalance) : 'Not parsed'} />
      <MetricCard label="Cash Reserve monthly OIP ADB" value={fmtC(st.cashReserveOipAverageDailyBalance)} sub={<div style={{ fontSize: 11, color: C.s500 }}>A different measure; do not compare directly to projected ending balance.</div>} />
    </div>

    {table.length > 0 && <div style={{ ...card, overflowX: 'auto' }}>
      <div style={{ padding: '14px 18px', fontWeight: 800, color: C.navy, borderBottom: `1px solid ${C.s200}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span>General Fund Financial Status</span>
        <ExportBtn onClick={() => downloadCsv('ne_gf_status.csv', ['Line Item', ...years], table.map((row) => [row.label, ...years.map((fy) => row.values?.[fy])]))} />
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5, minWidth: 680 }}>
        <thead><tr style={{ background: C.navy, color: '#fff' }}><th style={{ textAlign: 'left', padding: '10px 14px', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1 }}>Line item</th>{years.map((fy) => <th key={fy} style={{ textAlign: 'right', padding: '10px 14px', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1 }}>{fy}</th>)}</tr></thead>
        <tbody>{table.map((row, idx) => { const highlight = String(row.label || '').includes('Ending') || String(row.label || '').includes('Appropriation'); return <tr key={row.label || idx} style={{ background: highlight ? C.goldDim : idx % 2 === 0 ? C.s50 : '#fff', borderBottom: `1px solid ${C.s100}`, fontWeight: highlight ? 700 : 400 }}><td style={{ padding: '9px 14px', color: C.navy }}>{row.label}</td>{years.map((fy) => { const value = row.values?.[fy]; return <td key={fy} style={{ padding: '9px 14px', textAlign: 'right', color: value < 0 ? C.red : C.s800 }}>{value == null ? '—' : value < 0 ? `(${fmt(Math.abs(value))})` : fmt(value)}</td>; })}</tr>; })}</tbody>
      </table>
    </div>}
  </div>;
}

/* ═══════════════════ AGENCIES ═══════════════════ */

function AgenciesTab({ agencies, population = NE_POP_FALLBACK }) {
  if (!agencies || agencies.length === 0) return <div style={panel}>No agency data loaded.</div>;
  const sorted = [...agencies].sort((a, b) => (b.all_funds || 0) - (a.all_funds || 0));
  const totalGF = sorted.reduce((s, a) => s + (a.appropriation || 0), 0);
  const topAgency = sorted[0];

  return <div style={{ display: 'grid', gap: 12 }}>
    <Narrative>
      Nebraska appropriates <strong>{fmtC(totalGF)}</strong> in General Fund dollars — about <strong>${Math.round(totalGF / population).toLocaleString()} per resident</strong>.
      {topAgency && topAgency.appropriation > 0 && <> {topAgency.name} accounts for {fmtP(topAgency.appropriation / totalGF)} of General Fund appropriations, or ${Math.round(topAgency.appropriation / population).toLocaleString()} per resident.</>}
    </Narrative>

    <div style={{ ...panel, borderLeft: `4px solid ${C.blue}`, background: C.blueDim }}>
      <div style={{ fontSize: 13, color: '#1E3A5F', lineHeight: 1.6 }}>
        <strong>Reading this:</strong>{' '}
        <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: C.navy, verticalAlign: 'middle', marginRight: 3 }} /> General Fund (Legislature-controlled) vs.{' '}
        <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: C.goldLight, verticalAlign: 'middle', marginLeft: 6, marginRight: 3 }} /> Other funds (cash, construction, federal, and revolving). Cash funds are generally earmarked fees and charges; federal funds are reported separately.
      </div>
    </div>

    <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
      <ExportBtn onClick={() => downloadCsv('ne_agency_appropriations.csv', ['Agency ID', 'Name', 'General', 'Cash', 'Construction', 'Federal', 'Revolving', 'Total'], sorted.map((a) => [a.id, a.name, a.general_fund, a.cash_fund, a.construction_fund, a.federal_fund, a.revolving_fund, a.all_funds]))} />
    </div>

    {sorted.map((a) => {
      const gf = a.appropriation || 0, cf = a.cash_fund || 0, total = a.all_funds || gf + cf;
      const share = total > 0 ? gf / total : 0;
      const perCap = Math.round(gf / population);
      return <div key={a.id} style={panel}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 14, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div><div style={{ fontSize: 11, color: C.s500, textTransform: 'uppercase', letterSpacing: 1.2 }}>Agency {a.id}</div><div style={{ fontSize: 15, fontWeight: 800, color: C.navy, marginTop: 4 }}>{a.name}</div></div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 22, fontWeight: 900 }}>{fmtC(total)}</div>
            <div style={{ fontSize: 11, color: C.s500 }}>all funds</div>
            {perCap > 0 && <div style={{ fontSize: 11, color: C.gold, fontWeight: 700, marginTop: 2 }}>${perCap}/resident (GF)</div>}
          </div>
        </div>
        <div style={{ marginTop: 12, height: 10, background: C.s100, borderRadius: 999, overflow: 'hidden', display: 'flex' }}><div style={{ width: `${share * 100}%`, background: C.navy }} /><div style={{ flex: 1, background: C.goldLight }} /></div>
        <div style={{ marginTop: 8, display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 12, color: C.s500, flexWrap: 'wrap' }}>
          <div><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: C.navy, marginRight: 4 }} />GF: {fmt(gf)} ({fmtP(share)})</div>
          <div><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: C.goldLight, marginRight: 4 }} />Other funds: {fmt(total - gf)}</div>
        </div>
      </div>;
    })}
  </div>;
}

/* ═══════════════════ LEGISLATIVE FUND REVIEW ═══════════════════ */

function reviewSignal(fund) {
  const history = fund.history || [];
  if (history.length < 2) return { label: 'Trend building', color: C.s500, bg: C.s100 };
  const balances = history.map((point) => Number(point.balance || 0));
  const latest = Math.abs(balances[balances.length - 1]) || 1;
  const range = Math.max(...balances) - Math.min(...balances);
  if (history.length >= 3 && range / latest <= 0.01) return { label: 'Little movement', color: '#92400E', bg: C.amberDim };
  if (fund.delta > 0) return { label: 'Balance increased', color: '#047857', bg: C.emeraldDim };
  if (fund.delta < 0) return { label: 'Balance declined', color: '#991B1B', bg: C.redDim };
  return { label: 'No monthly change', color: '#92400E', bg: C.amberDim };
}

function FundReviewTab({ funds, onNav }) {
  const [rawSearch, setRawSearch] = useState('');
  const search = useDebounce(rawSearch);
  const [category, setCategory] = useState('Cash');
  const [minimum, setMinimum] = useState(10000000);
  const [sortBy, setSortBy] = useState('balance');
  const [selected, setSelected] = useState(() => new Set());

  const categories = useMemo(() => {
    const available = [...new Set(funds.filter((fund) => !fund.dormant && fund.category !== 'General').map((fund) => fund.category))];
    return ['All non-General', ...available.sort()];
  }, [funds]);

  const candidates = useMemo(() => {
    const needle = search.toLowerCase();
    const result = funds.filter((fund) => {
      if (fund.dormant || fund.category === 'General' || fund.balance < minimum) return false;
      if (category !== 'All non-General' && fund.category !== category) return false;
      const haystack = `${fund.id} ${fund.title} ${fund.agency_name} ${fund.description} ${fund.statutory_authority}`.toLowerCase();
      return !needle || haystack.includes(needle);
    });
    return result.sort((a, b) => {
      if (sortBy === 'interest') return Math.abs(b.interest) - Math.abs(a.interest) || b.balance - a.balance;
      if (sortBy === 'change') return b.delta - a.delta || b.balance - a.balance;
      if (sortBy === 'movement') {
        const aMovement = a.history.length > 1 ? Math.abs(a.delta) / (Math.abs(a.balance) || 1) : Number.POSITIVE_INFINITY;
        const bMovement = b.history.length > 1 ? Math.abs(b.delta) / (Math.abs(b.balance) || 1) : Number.POSITIVE_INFINITY;
        return aMovement - bMovement || b.balance - a.balance;
      }
      return b.balance - a.balance;
    });
  }, [funds, search, category, minimum, sortBy]);

  const selectedFunds = useMemo(() => funds.filter((fund) => selected.has(fund.id)), [funds, selected]);
  const visibleBalance = candidates.reduce((sum, fund) => sum + fund.balance, 0);
  const visibleInterest = candidates.reduce((sum, fund) => sum + Math.abs(fund.interest), 0);
  const selectedBalance = selectedFunds.reduce((sum, fund) => sum + fund.balance, 0);
  const selectedInterest = selectedFunds.reduce((sum, fund) => sum + Math.abs(fund.interest), 0);
  const exportFunds = selectedFunds.length ? selectedFunds : candidates;

  const toggleFund = (id) => setSelected((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const selectVisible = () => setSelected(new Set(candidates.map((fund) => fund.id)));

  return <div style={{ display: 'grid', gap: 18 }}>
    <div>
      <div style={{ fontSize: 22, fontWeight: 900, color: C.navy }}>Legislative Fund Review</div>
      <Narrative>
        Find substantial balances that may warrant a legislative question. Select funds to total their latest Operating Investment Pool average daily balances, then open the Fund Explorer for statutory purpose and agency context.
      </Narrative>
    </div>

    <div style={{ ...panel, borderLeft: `4px solid ${C.gold}`, background: C.goldDim }}>
      <div style={{ fontSize: 12.5, color: '#713F12', lineHeight: 1.7 }}>
        <strong>A review candidate is not a finding that money is legally available, inactive, unobligated, or transferable.</strong> The queue uses official OIP average daily balances and LFO directory information to identify where further legislative review may be useful.
      </div>
    </div>

    <div className="metric-grid">
      <MetricCard label="Funds in review" value={candidates.length.toLocaleString()} />
      <MetricCard label="Combined OIP ADB" value={fmtC(visibleBalance)} />
      <MetricCard label="Monthly allocated interest" value={fmtC(visibleInterest)} />
      <MetricCard label={selectedFunds.length ? `${selectedFunds.length} selected` : 'Selected total'} value={selectedFunds.length ? fmtC(selectedBalance) : '—'} sub={selectedFunds.length ? <span style={{ fontSize: 11.5, color: C.s500 }}>{fmtC(selectedInterest)} monthly allocated interest</span> : null} />
    </div>

    <div style={card}>
      <div style={{ padding: 18, borderBottom: `1px solid ${C.s200}`, background: C.s50 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ fontWeight: 800, color: C.navy }}>Review queue</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" onClick={selectVisible} disabled={!candidates.length} style={{ border: `1px solid ${C.s300}`, background: '#fff', color: C.s700, borderRadius: 7, padding: '5px 10px', cursor: candidates.length ? 'pointer' : 'default', fontSize: 11.5, fontWeight: 700 }}>Select visible</button>
            {selectedFunds.length > 0 && <button type="button" onClick={() => setSelected(new Set())} style={{ border: `1px solid ${C.s300}`, background: '#fff', color: C.s700, borderRadius: 7, padding: '5px 10px', cursor: 'pointer', fontSize: 11.5, fontWeight: 700 }}>Clear selection</button>}
            <ExportBtn onClick={() => downloadCsv('ne_legislative_fund_review.csv', ['Fund', 'Title', 'Category', 'OIP Average Daily Balance', 'Allocated Interest', 'Month-over-Month Change', 'Agency', 'Statutory Authority', 'Purpose', 'Review Signal'], exportFunds.map((fund) => [fund.id, fund.title, fund.category, fund.balance, fund.interest, fund.delta, fund.agency_name, fund.statutory_authority, fund.description, reviewSignal(fund).label]))} />
          </div>
        </div>

        <div style={{ position: 'relative', marginTop: 12 }}><Search style={{ width: 15, height: 15, color: C.s400, position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)' }} /><input value={rawSearch} onChange={(event) => setRawSearch(event.target.value)} placeholder="Search fund, agency, purpose, or statute..." style={{ width: '100%', padding: '10px 12px 10px 32px', borderRadius: 10, border: `1px solid ${C.s300}`, background: '#fff' }} /></div>

        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 14, alignItems: 'flex-end', flexWrap: 'wrap', marginTop: 12 }}>
          <div>
            <div style={{ fontSize: 10, color: C.s500, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>Fund type</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>{categories.map((item) => <button key={item} type="button" onClick={() => setCategory(item)} style={{ border: category === item ? 'none' : `1px solid ${C.s300}`, background: category === item ? C.navy : '#fff', color: category === item ? '#fff' : C.s700, borderRadius: 999, padding: '5px 10px', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>{item}</button>)}</div>
          </div>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            <label style={{ fontSize: 11, color: C.s500 }}>Minimum balance<br /><select value={minimum} onChange={(event) => setMinimum(Number(event.target.value))} style={{ marginTop: 5, border: `1px solid ${C.s300}`, borderRadius: 7, padding: '6px 9px', background: '#fff', color: C.s700 }}><option value={1000000}>$1 million</option><option value={10000000}>$10 million</option><option value={25000000}>$25 million</option><option value={50000000}>$50 million</option></select></label>
            <label style={{ fontSize: 11, color: C.s500 }}>Sort by<br /><select value={sortBy} onChange={(event) => setSortBy(event.target.value)} style={{ marginTop: 5, border: `1px solid ${C.s300}`, borderRadius: 7, padding: '6px 9px', background: '#fff', color: C.s700 }}><option value="balance">Largest balance</option><option value="interest">Most interest</option><option value="change">Largest increase</option><option value="movement">Least movement</option></select></label>
          </div>
        </div>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table className="review-table" style={{ width: '100%', borderCollapse: 'collapse', minWidth: 940 }}>
          <thead><tr>{['', 'Fund', 'Agency / statutory authority', 'OIP average daily balance', 'Allocated interest', 'Monthly change', 'Signal', ''].map((heading, index) => <th key={`${heading}-${index}`} style={{ padding: '10px 12px', textAlign: index >= 3 && index <= 5 ? 'right' : 'left', fontSize: 10, color: C.s500, textTransform: 'uppercase', letterSpacing: .8, borderBottom: `1px solid ${C.s200}`, background: '#fff' }}>{heading}</th>)}</tr></thead>
          <tbody>{candidates.map((fund) => {
            const signal = reviewSignal(fund);
            return <tr key={fund.id} style={{ background: selected.has(fund.id) ? C.blueDim : '#fff' }}>
              <td style={{ padding: 12, borderBottom: `1px solid ${C.s100}` }}><input type="checkbox" aria-label={`Select ${fund.title}`} checked={selected.has(fund.id)} onChange={() => toggleFund(fund.id)} /></td>
              <td style={{ padding: 12, borderBottom: `1px solid ${C.s100}`, maxWidth: 300 }}><div style={{ fontSize: 12.5, fontWeight: 800, color: C.navy }}>{fund.title}</div><div style={{ fontSize: 10.5, color: C.s400, marginTop: 3 }}>Fund {fund.id} · {fund.category}</div></td>
              <td style={{ padding: 12, borderBottom: `1px solid ${C.s100}`, maxWidth: 280 }}><div style={{ fontSize: 11.5, color: C.s700 }}>{fund.agency_name || 'Agency not identified'}</div><div style={{ fontSize: 10.5, color: C.s400, marginTop: 3 }}>{fund.statutory_authority || 'Statutory authority not provided'}</div></td>
              <td style={{ padding: 12, borderBottom: `1px solid ${C.s100}`, textAlign: 'right', fontSize: 13, fontWeight: 900, color: C.s900 }}>{fmtC(fund.balance)}</td>
              <td style={{ padding: 12, borderBottom: `1px solid ${C.s100}`, textAlign: 'right', fontSize: 12, fontWeight: 700 }}>{fmtC(Math.abs(fund.interest))}</td>
              <td style={{ padding: 12, borderBottom: `1px solid ${C.s100}`, textAlign: 'right' }}>{fund.history.length > 1 ? (fund.delta === 0 ? <span style={{ fontSize: 11.5, color: C.s500 }}>No change</span> : <Delta value={fund.delta} compact />) : <span style={{ fontSize: 10.5, color: C.s400 }}>Next report</span>}</td>
              <td style={{ padding: 12, borderBottom: `1px solid ${C.s100}` }}><Badge text={signal.label.toUpperCase()} color={signal.color} bg={signal.bg} /></td>
              <td style={{ padding: 12, borderBottom: `1px solid ${C.s100}` }}><button type="button" onClick={() => onNav('funds', fund.id)} style={{ border: `1px solid ${C.s300}`, background: '#fff', color: C.navy, borderRadius: 7, padding: '5px 9px', cursor: 'pointer', fontSize: 11, fontWeight: 700 }}>Details</button></td>
            </tr>;
          })}</tbody>
        </table>
        {candidates.length === 0 && <div style={{ padding: 40, textAlign: 'center', color: C.s400 }}>No funds match the current review filters.</div>}
      </div>
    </div>

    <div style={{ ...panel, background: C.s50 }}>
      <div style={{ fontWeight: 800, color: C.navy, marginBottom: 6 }}>How the trend signal works</div>
      <div style={{ fontSize: 12.5, color: C.s500, lineHeight: 1.7 }}>The dashboard now preserves each newly published monthly OIP balance. After two reports it will show month-over-month change; after three reports it can flag balances with little movement. It does not infer obligations or legal availability from cash movement alone.</div>
    </div>
  </div>;
}

/* ═══════════════════ FUND EXPLORER ═══════════════════ */

function FundsTab({ funds, selectedId, onSelect, showDormantInit = false }) {
  const [rawSearch, setRawSearch] = useState('');
  const search = useDebounce(rawSearch);
  const [showDormant, setShowDormant] = useState(showDormantInit);
  const [cat, setCat] = useState('All');

  useEffect(() => { if (showDormantInit) setShowDormant(true); }, [showDormantInit]);

  const cats = useMemo(() => ['All', ...new Set(funds.map((f) => f.category))], [funds]);
  const filtered = useMemo(() => funds.filter((f) => {
    if (!showDormant && f.dormant) return false;
    if (cat !== 'All' && f.category !== cat) return false;
    const hay = `${f.title} ${f.description} ${f.statutory_authority} ${f.agency_name}`.toLowerCase();
    return !search || hay.includes(search.toLowerCase()) || f.id.includes(search);
  }), [funds, showDormant, cat, search]);

  const sel = funds.find((f) => f.id === selectedId) || null;
  const dCt = funds.filter((f) => f.dormant).length;

  return <div className="fund-layout">
    <div style={card}>
      <div style={{ padding: 18, borderBottom: `1px solid ${C.s200}`, background: C.s50 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ fontWeight: 800, color: C.navy }}>Fund Explorer</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" onClick={() => setShowDormant((v) => !v)} style={{ border: `1px solid ${showDormant ? C.amber : C.s300}`, background: showDormant ? C.amberDim : '#fff', color: showDormant ? '#92400E' : C.s700, borderRadius: 8, padding: '6px 11px', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}><FileText style={{ width: 14, height: 14 }} />{showDormant ? `Reference-only (${dCt})` : 'Show reference-only'}</button>
            <ExportBtn onClick={() => downloadCsv('ne_funds.csv', ['ID', 'Title', 'Category', 'OIP Average Daily Balance', 'Allocated Interest', 'Reference Only', 'Agency', 'Statute', 'Description'], filtered.map((f) => [f.id, f.title, f.category, f.balance, f.interest, f.dormant, f.agency_name, f.statutory_authority, f.description]))} />
          </div>
        </div>
        <div style={{ position: 'relative', marginTop: 12 }}><Search style={{ width: 15, height: 15, color: C.s400, position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)' }} /><input value={rawSearch} onChange={(e) => setRawSearch(e.target.value)} placeholder="Search funds, agencies, statutes..." style={{ width: '100%', padding: '10px 12px 10px 32px', borderRadius: 10, border: `1px solid ${C.s300}`, background: '#fff' }} /></div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 12 }}>{cats.map((c) => <button key={c} type="button" onClick={() => setCat(c)} style={{ border: cat === c ? 'none' : `1px solid ${C.s300}`, background: cat === c ? C.navy : '#fff', color: cat === c ? '#fff' : C.s700, borderRadius: 999, padding: '5px 10px', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>{c}</button>)}</div>
        <div style={{ marginTop: 10, fontSize: 11, color: C.s500 }}>{filtered.length} fund{filtered.length !== 1 ? 's' : ''} · <span style={{ color: C.emerald }}>{filtered.filter((f) => !f.dormant).length} in latest OIP</span>{showDormant && <> · <span style={{ color: C.amber }}>{filtered.filter((f) => f.dormant).length} directory-only</span></>}</div>
      </div>
      <div style={{ maxHeight: 640, overflowY: 'auto' }}>{filtered.map((f) => <button key={f.id} type="button" onClick={() => onSelect(f.id)} style={{ width: '100%', border: 'none', background: sel?.id === f.id ? '#EFF6FF' : f.dormant ? C.amberDim : '#fff', borderBottom: `1px solid ${C.s100}`, borderLeft: sel?.id === f.id ? `3px solid ${C.navy}` : '3px solid transparent', padding: 14, textAlign: 'left', cursor: 'pointer' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 14, alignItems: 'flex-start' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>{f.dormant && <FileText style={{ width: 13, height: 13, color: '#D97706', flexShrink: 0 }} />}<div><div style={{ fontSize: 12.5, fontWeight: 700, color: f.dormant ? '#92400E' : C.navy }}>{f.title}</div><div style={{ fontSize: 10.5, color: C.s400, marginTop: 2 }}>#{f.id} · {f.category}{f.agency_name ? ` · ${f.agency_name}` : ''}</div></div></div>
          <div style={{ textAlign: 'right', flexShrink: 0 }}>{f.dormant ? <Badge text="REFERENCE ONLY" color="#92400E" bg="rgba(245,158,11,.14)" /> : <><div style={{ fontWeight: 800, fontSize: 13 }}>{fmtC(f.balance)}</div>{f.delta !== 0 && <div style={{ marginTop: 4 }}><Delta value={f.delta} compact /></div>}</>}</div>
        </div>
      </button>)}{filtered.length === 0 && <div style={{ padding: 40, textAlign: 'center', color: C.s400 }}>No funds match.</div>}</div>
    </div>

    <div>{sel ? <div style={{ ...card, position: 'sticky', top: 72 }}>
      <div style={{ padding: 20, background: `linear-gradient(135deg, ${sel.dormant ? '#92400E' : C.navy}, ${sel.dormant ? '#B45309' : C.navyMid})`, color: '#fff', display: 'flex', justifyContent: 'space-between', gap: 14, alignItems: 'flex-start' }}>
        <div><div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}><div style={{ fontSize: 11, color: sel.dormant ? '#FDE68A' : C.goldLight, textTransform: 'uppercase', letterSpacing: 1.3 }}>Fund {sel.id} · {sel.category}</div>{sel.dormant && <Badge text="REFERENCE ONLY" color="#FDE68A" bg="rgba(253,230,138,.14)" />}</div><div style={{ fontSize: 18, fontWeight: 900, marginTop: 6 }}>{sel.title}</div></div>
        <button type="button" onClick={() => onSelect(null)} style={{ border: 'none', background: 'rgba(255,255,255,.12)', color: '#fff', borderRadius: 8, padding: 6, cursor: 'pointer' }}><X style={{ width: 15, height: 15 }} /></button>
      </div>
      <div style={{ padding: 20 }}>
        {sel.history?.length > 1 && !sel.dormant && <div style={{ marginBottom: 18, background: C.s50, borderRadius: 8, padding: 10, border: `1px solid ${C.s100}` }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: C.s400, textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 6 }}>5-month cash trend ($M)</div>
          <div style={{ height: 90 }}><ResponsiveContainer width="100%" height="100%"><AreaChart data={sel.history}><defs><linearGradient id="dG" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={sel.delta >= 0 ? C.emerald : C.red} stopOpacity={.2} /><stop offset="100%" stopColor={sel.delta >= 0 ? C.emerald : C.red} stopOpacity={0} /></linearGradient></defs>
          <XAxis dataKey="m" tick={{ fill: C.s400, fontSize: 10 }} axisLine={false} tickLine={false} /><ReTooltip formatter={(v) => `$${v}M`} /><Area type="monotone" dataKey="b" stroke={sel.delta >= 0 ? C.emerald : C.red} strokeWidth={2.5} fill="url(#dG)" dot={{ r: 3, fill: C.gold, stroke: sel.delta >= 0 ? C.emerald : C.red, strokeWidth: 2 }} /></AreaChart></ResponsiveContainer></div>
        </div>}
        {sel.description ? <div style={{ fontSize: 13, color: C.s700, lineHeight: 1.7, marginBottom: 18 }}>{sel.description}</div> : <div style={{ fontSize: 12.5, color: C.s400, fontStyle: 'italic', marginBottom: 18 }}>No description available in the LFO Directory for this fund.</div>}
        {sel.dormant && <div style={{ background: C.amberDim, border: '1px solid #FDE68A', borderRadius: 8, padding: 12, marginBottom: 18 }}>
          <div style={{ fontSize: 12.5, color: '#92400E', lineHeight: 1.7, fontWeight: 600, display: 'flex', alignItems: 'flex-start', gap: 6 }}><AlertTriangle style={{ width: 14, height: 14, marginTop: 2, flexShrink: 0 }} /><span>This fund appears in the LFO directory but not in the latest OIP report. OIP absence alone does not show whether it is active, abolished, or has another type of balance.</span></div>
        </div>}
        <div style={{ display: 'grid', gap: 8 }}>{[
          ['Latest OIP average daily balance', sel.dormant ? 'No entry in latest OIP report' : fmt(sel.balance)],
          ...(sel.delta && !sel.dormant ? [['Month-over-month', (sel.delta >= 0 ? '+' : '') + fmt(sel.delta)]] : []),
          ['Statutory authority', sel.statutory_authority || 'Not provided'],
          ['Agency', sel.agency_name || 'N/A'],
          ['Program', sel.program || 'N/A'],
          ...(sel.approp > 0 ? [['SFY appropriation', fmt(sel.approp)], ['SFY expended', fmt(sel.expended)], ['Remaining authority', fmt(sel.approp - sel.expended)]] : []),
          ...(sel.ending_balance != null ? [['LFO reported balance', fmt(sel.ending_balance)]] : []),
        ].map(([l, v]) => <div key={l} style={{ display: 'flex', justifyContent: 'space-between', gap: 14, fontSize: 12.5, borderBottom: `1px solid ${C.s100}`, paddingBottom: 7 }}><div style={{ color: C.s500 }}>{l}</div><div style={{ fontWeight: 700, color: C.s800, textAlign: 'right' }}>{v}</div></div>)}</div>
        {sel.approp > 0 && !sel.dormant && <div style={{ marginTop: 14 }}><div style={{ fontSize: 10, fontWeight: 700, color: C.s400, textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 6 }}>Appropriation burn rate</div><PBar pct={sel.expended / sel.approp} color={sel.expended / sel.approp > 0.9 ? C.red : C.navyLight} height={8} label={`${fmtC(sel.approp - sel.expended)} remaining`} /></div>}
      </div>
    </div> : <div style={{ ...panel, display: 'grid', placeItems: 'center', minHeight: 260, textAlign: 'center', color: C.s500 }}><div><FileText style={{ width: 34, height: 34, margin: '0 auto 10px', color: C.s300 }} /><div style={{ fontWeight: 800, color: C.s700 }}>No fund selected</div><div style={{ marginTop: 6, fontSize: 13 }}>Choose a fund for details, description, and appropriation chain.</div></div></div>}</div>
  </div>;
}

/* ═══════════════════ REFERENCE ═══════════════════ */

function ReferenceTab({ data }) {
  const population = data.population?.value || NE_POP_FALLBACK;
  const secs = [
    { t: 'Fund Types', items: [{ t: 'General Fund (10000)', d: 'Receipts not earmarked by statute, including major income and sales taxes.' }, { t: 'Cash Funds (20000s)', d: 'Dedicated fees and charges restricted to statutory purposes.' }, { t: 'Federal Funds (40000s)', d: 'Grants, contracts, and matching funds from the federal government.' }, { t: 'Revolving Funds (50000s)', d: 'Interagency transactions where one agency provides goods or services to another.' }, { t: 'Trust Funds (60000s)', d: 'Fiduciary funds held for individuals or entities.' }, { t: 'Reference-only record', d: 'Listed in the LFO directory but absent from the latest OIP report. This is not a finding that the fund is dormant.' }] },
    { t: 'Budget Terms', items: [{ t: 'Average Daily Balance (ADB)', d: 'Weighted average cash held in a fund over the reporting month; this is not a point-in-time ending balance.' }, { t: 'Legislative Fund Review', d: 'A screening queue for substantial non-General Fund balances. Inclusion identifies a question for further review, not a finding that money is inactive, unobligated, available, or transferable.' }, { t: 'NEFAB', d: 'Nebraska Economic Forecasting Advisory Board, which establishes official General Fund revenue forecasts.' }, { t: 'Minimum Reserve', d: 'A statutory 3% minimum reserve calculation at the end of a biennium.' }, { t: 'Per Capita', d: `Divided by the Census Bureau's July 1, 2025 Nebraska population estimate (${(population / 1e6).toFixed(2)}M).` }] },
    { t: 'Data Sources', items: [{ t: 'OIP Report', d: 'Monthly average daily balances and allocated interest from DAS State Accounting.' }, { t: 'General Fund Financial Status', d: 'Official legislative snapshot; it updates on a different schedule from monthly revenue reports.' }, { t: 'Current Fiscal Year Budget', d: 'Agency appropriations by General, Cash, Construction, Federal, and Revolving funds.' }, { t: 'LFO Directory', d: 'Legislative Fiscal Office reference information and statutory authority for state funds.' }] },
  ];
  return <div style={{ display: 'grid', gap: 18 }}><div><div style={{ fontSize: 20, fontWeight: 900, color: C.navy }}>Reference & Definitions</div></div>
    {secs.map((sec) => <div key={sec.t} style={panel}><div style={{ fontWeight: 800, color: C.navy, marginBottom: 12 }}>{sec.t}</div>{sec.items.map((i) => <div key={i.t} style={{ padding: '10px 0', borderBottom: `1px solid ${C.s100}` }}><div style={{ fontWeight: 700, fontSize: 13, color: C.s800, marginBottom: 3 }}>{i.t}</div><div style={{ fontSize: 12.5, color: C.s500, lineHeight: 1.7 }}>{i.d}</div></div>)}</div>)}
    <div style={{ ...panel, background: C.goldDim, borderLeft: `4px solid ${C.gold}` }}><div style={{ fontSize: 12.5, color: '#713F12', lineHeight: 1.7 }}><strong>Official sources:</strong>{' '}<a href="https://nebraskalegislature.gov/reports/fiscal.php" target="_blank" rel="noreferrer" style={{ color: C.navyMid }}>Fiscal Reports</a> · <a href="https://revenue.nebraska.gov/about/news-releases/general-fund-receipts-news-releases" target="_blank" rel="noreferrer" style={{ color: C.navyMid }}>General Fund Receipts</a> · <a href="https://das.nebraska.gov/accounting/financial_reports.php" target="_blank" rel="noreferrer" style={{ color: C.navyMid }}>DAS Accounting</a> · <a href="https://statespending.nebraska.gov/CurrentFiscalYearBudget" target="_blank" rel="noreferrer" style={{ color: C.navyMid }}>Current Fiscal Year Budget</a></div></div>
  </div>;
}

/* ═══════════════════ APP SHELL ═══════════════════ */

export default function NebraskaBudgetDashboard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [rawShape, setRawShape] = useState(null);
  const [dataSource, setDataSource] = useState(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const sources = [
          { id: 'repository', url: DATA_URL },
          { id: 'legacy', url: LEGACY_DATA_URL },
        ];
        const failures = [];
        let raw = null;
        let loadedFrom = null;

        for (const source of sources) {
          try {
            const separator = source.url.includes('?') ? '&' : '?';
            const response = await fetch(`${source.url}${separator}t=${Date.now()}`, { cache: 'no-store' });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            raw = await response.json();
            if (!raw || !Array.isArray(raw.funds)) throw new Error('Invalid response shape');
            loadedFrom = source.id;
            break;
          } catch (sourceError) {
            failures.push(`${source.id}: ${sourceError.message || String(sourceError)}`);
          }
        }

        if (!raw) throw new Error(`All data sources failed (${failures.join('; ')})`);

        const shape = {
          topLevelKeys: Object.keys(raw || {}),
          fundsCount: (raw?.funds || []).length,
          descriptionsCount: Object.keys(raw?.fundDescriptions || {}).length,
          agenciesCount: (raw?.agencies || []).length,
          hasGfStatus: !!raw?.generalFundStatus,
          hasGfStatusTable: (raw?.gfStatusTable || []).length,
          sampleFund: raw?.funds?.[0],
        };
        console.log('[Dashboard] Live data loaded:', shape);
        setRawShape(shape);
        setDataSource(loadedFrom);

        setData(normalizeData(raw));
      } catch (err) {
        console.error('[Dashboard] Fetch error:', err);
        setError(err.message || String(err));
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  const parseHash = () => {
    const h = window.location.hash.replace('#', '');
    const [t, fid] = h.split('/');
    return { tab: TABS.find((x) => x.id === t)?.id || 'overview', fundId: fid || null };
  };

  const [tab, setTab] = useState(() => parseHash().tab);
  const [selectedFundId, setSelectedFundId] = useState(() => parseHash().fundId);
  const [showDormantInit, setShowDormantInit] = useState(false);

  useEffect(() => {
    const onHash = () => { const p = parseHash(); setTab(p.tab); if (p.fundId) setSelectedFundId(p.fundId); };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const navigate = useCallback((newTab, fundId = null, dormant = false) => {
    setTab(newTab);
    if (fundId !== undefined) setSelectedFundId(fundId);
    if (dormant) setShowDormantInit(true);
    window.history.replaceState(null, '', `#${newTab}${fundId ? `/${fundId}` : ''}`);
  }, []);

  const selectFund = useCallback((id) => {
    setSelectedFundId(id);
    window.history.replaceState(null, '', id ? `#funds/${id}` : '#funds');
  }, []);

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: C.s50, color: C.navy, fontFamily: 'Inter, sans-serif' }}>
        <div style={{ textAlign: 'center' }}>
          <Landmark style={{ width: 48, height: 48, color: C.gold, marginBottom: 16 }} />
          <h2>Loading Nebraska Budget Data...</h2>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: C.s50, color: C.red, fontFamily: 'Inter, sans-serif', padding: 24 }}>
        <div style={{ textAlign: 'center', maxWidth: 600 }}>
          <AlertTriangle style={{ width: 48, height: 48, color: C.red, marginBottom: 16 }} />
          <h2>Data Sync Error</h2>
          <p style={{ color: C.s700, marginTop: 12, lineHeight: 1.7 }}>{error}</p>
          <p style={{ color: C.s500, marginTop: 12, fontSize: 13 }}>The public data file may not have been generated yet. Check the latest GitHub Actions run.</p>
        </div>
      </div>
    );
  }

  const hasDescriptions = data.funds.some((f) => f.description);
  const hasGfStatus = data.gfStatusTable && data.gfStatusTable.length > 0;
  const showDataWarning = dataSource === 'legacy' || !hasDescriptions || !hasGfStatus || data.warnings.length > 0;

  return (
    <div style={{ minHeight: '100vh', background: C.s50, color: C.s800, fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif' }}>
      <style>{`
        * { box-sizing: border-box; }
        .page-wrap { max-width: 1280px; margin: 0 auto; padding: 0 24px; }
        .metric-grid { display: grid; gap: 14px; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); }
        .two-col { display: grid; gap: 18px; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
        .three-col { display: grid; gap: 18px; grid-template-columns: repeat(3, minmax(0, 1fr)); }
        .fund-layout { display: grid; gap: 18px; grid-template-columns: minmax(0, 1.35fr) minmax(320px, .9fr); align-items: start; }
        @media (max-width: 980px) { .two-col, .three-col, .fund-layout { grid-template-columns: 1fr; } }
        button, input, select { font: inherit; }
        input:focus, select:focus, button:focus-visible { outline: 2px solid ${C.gold}; outline-offset: 1px; }
      `}</style>

      <header style={{ background: `linear-gradient(135deg, ${C.navy}, ${C.navyMid}, ${C.navyLight})`, color: '#fff' }}>
        <div className="page-wrap" style={{ paddingTop: 18, paddingBottom: 18, display: 'flex', justifyContent: 'space-between', gap: 18, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{ width: 42, height: 42, borderRadius: 10, background: 'rgba(201,168,76,.12)', display: 'grid', placeItems: 'center', border: '1px solid rgba(201,168,76,.24)' }}><Landmark style={{ width: 22, height: 22, color: C.gold }} /></div>
            <div><div style={{ fontSize: 20, fontWeight: 900 }}>Nebraska Public Budget Dashboard</div><div style={{ fontSize: 11, color: C.goldLight, letterSpacing: 2, textTransform: 'uppercase', marginTop: 2 }}>Cash pool · Revenue · Appropriations · Fund accountability</div></div>
          </div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,.68)', lineHeight: 1.7 }}>
            <div>Cash: <span style={{ color: '#fff' }}>{data.lastUpdated?.cash || 'Unknown'}</span></div>
            <div>Budget: <span style={{ color: '#fff' }}>{data.lastUpdated?.budget || 'Unknown'}</span></div>
            <div>Revenue: <span style={{ color: '#fff' }}>{data.lastUpdated?.revenue || data.revenue?.period || 'Unknown'}</span></div>
          </div>
        </div>
      </header>

      <nav style={{ background: '#fff', borderBottom: `1px solid ${C.s200}`, position: 'sticky', top: 0, zIndex: 10 }}>
        <div className="page-wrap" style={{ display: 'flex', gap: 4, overflowX: 'auto' }}>
          {TABS.map((t) => { const a = tab === t.id, I = t.icon; return <button key={t.id} type="button" onClick={() => navigate(t.id)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '14px 16px', border: 'none', borderBottom: `3px solid ${a ? C.gold : 'transparent'}`, background: 'transparent', color: a ? C.navy : C.s500, fontWeight: a ? 800 : 600, cursor: 'pointer', whiteSpace: 'nowrap' }}><I style={{ width: 14, height: 14 }} />{t.label}</button>; })}
        </div>
      </nav>

      <main className="page-wrap" style={{ paddingTop: 24, paddingBottom: 24 }}>
        {showDataWarning && (
          <div style={{ ...panel, borderLeft: `4px solid ${C.amber}`, background: C.amberDim, marginBottom: 18 }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
              <AlertTriangle style={{ width: 18, height: 18, color: '#D97706', marginTop: 2, flexShrink: 0 }} />
              <div style={{ fontSize: 12.5, color: '#92400E', lineHeight: 1.7 }}>
                <strong>{dataSource === 'legacy' ? 'Fallback data feed in use.' : 'Partial data loaded.'}</strong>{' '}
                {dataSource === 'legacy' && 'The repository snapshot is not available yet, so the dashboard is temporarily using its existing Google Apps Script feed. Dates shown in the header identify the reporting periods. '}
                {!hasDescriptions && 'No fund descriptions from LFO Directory are available. '}
                {!hasGfStatus && 'General Fund Status table is missing. '}
                {data.warnings.length > 0 && data.warnings.join(' ')}
              </div>
            </div>
          </div>
        )}

        <ErrorBoundary>
          {tab === 'overview' && <OverviewTab data={data} onNav={navigate} />}
          {tab === 'revenue' && <RevenueTab revenue={data.revenue} />}
          {tab === 'gfstatus' && <GFStatusTab data={data} />}
          {tab === 'agencies' && <AgenciesTab agencies={data.agencies} population={data.population?.value || NE_POP_FALLBACK} />}
          {tab === 'review' && <FundReviewTab funds={data.funds} onNav={navigate} />}
          {tab === 'funds' && <FundsTab funds={data.funds} selectedId={selectedFundId} onSelect={selectFund} showDormantInit={showDormantInit} />}
          {tab === 'reference' && <ReferenceTab data={data} />}
        </ErrorBoundary>
      </main>

      <footer style={{ borderTop: `1px solid ${C.s200}`, padding: '14px 24px', textAlign: 'center', fontSize: 11, color: C.s400 }}>
        Data: NE DAS State Accounting · NE Dept of Revenue · NE Legislative Fiscal Office
      </footer>
    </div>
  );
}

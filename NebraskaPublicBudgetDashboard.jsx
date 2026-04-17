import React, { useMemo, useState, useEffect, useCallback, useRef } from 'react';
import {
  AlertTriangle, ArrowDownRight, ArrowUpRight, BookOpen, Building2, Clock,
  Database, Download, FileText, Ghost, HelpCircle, Landmark, PieChart,
  Scale, Search, TrendingUp, X,
} from 'lucide-react';
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Pie,
  PieChart as RePieChart, ResponsiveContainer, Tooltip as ReTooltip,
  XAxis, YAxis, ReferenceLine,
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
  { id: 'funds', icon: Database, label: 'Fund Explorer' },
  { id: 'reference', icon: BookOpen, label: 'Reference' },
];

const NE_POP = 1970000; // 2024 Census est

/* ═══════════════════ DATA ═══════════════════ */

const rawData = {
  lastUpdated: { cash: '2/28/2026', budget: 'March 2026', revenue: 'January 2026', nefab: 'February 27, 2026' },
  macro: { totalBalance: 7469719377.80, totalInterest: -18649648.40, effectiveYield: '2.4967%', activeFunds: 855, totalFunds: 1502, dormantFunds: 642 },
  revenue: {
    period: 'January 2026', nefabBasis: 'February 27, 2026',
    ytdActual: 3845000000, ytdForecast: 3790000000,
    categories: [
      { name: 'Net Sales & Use', actual: 2765000000, forecast: 2500000000 },
      { name: 'Net Individual Income', actual: 2975000000, forecast: 3075000000 },
      { name: 'Net Corporate Income', actual: 740000000, forecast: 715000000 },
      { name: 'Miscellaneous Taxes', actual: 490000000, forecast: 335000000 },
    ],
    nefabForecasts: [
      { name: 'Sales & Use Tax', fy2526: 2765000000, fy2627: 2500000000, growth: '8.8%' },
      { name: 'Individual Income', fy2526: 2975000000, fy2627: 3075000000, growth: '11.5%' },
      { name: 'Corporate Income', fy2526: 740000000, fy2627: 715000000, growth: '-20.1%' },
      { name: 'Miscellaneous', fy2526: 490000000, fy2627: 335000000, growth: '-21.3%' },
    ],
    monthlySeries: [
      { month: 'Jul', actual: 580000000, forecast: 570000000 },
      { month: 'Aug', actual: 620000000, forecast: 610000000 },
      { month: 'Sep', actual: 540000000, forecast: 560000000 },
      { month: 'Oct', actual: 690000000, forecast: 650000000 },
      { month: 'Nov', actual: 710000000, forecast: 700000000 },
      { month: 'Dec', actual: 830000000, forecast: 1012000000 },
      { month: 'Jan', actual: 125000000, forecast: 110000000 },
    ],
  },
  gfStatusTable: [
    { label: 'Unobligated Beginning Balance', fy2425: 1804550647, fy2526: 515574973, fy2627: 355319553, fy2728: 202020474, fy2829: -277793317 },
    { label: 'Net Receipts (NEFAB)', fy2425: 6159041662, fy2526: 6970000000, fy2627: 6625000000, fy2728: 6859104045, fy2829: 7240395705 },
    { label: 'GF Transfers-Out', fy2425: -1694747425, fy2526: -1716331476, fy2627: -1777903800, fy2728: -1856279740, fy2829: -1918243227 },
    { label: 'Cash Reserve Transfers', fy2425: 4000000, fy2526: 0, fy2627: 282000000, fy2728: 0, fy2829: 0 },
    { label: 'General Fund Net Revenues', fy2425: 4462629700, fy2526: 5292257023, fy2627: 5185136131, fy2728: 5000589305, fy2829: 5319917478 },
    { label: 'General Fund Appropriations', fy2425: -5474665244, fy2526: -5432560355, fy2627: -5338435210, fy2728: -5475403096, fy2829: -5609755817 },
    { label: 'Ending Balance', fy2425: 792515104, fy2526: 375271641, fy2627: 202020474, fy2728: -272793317, fy2829: -567631656 },
  ],
  generalFundStatus: {
    beginningBalance_FY2526: 515574973, netRevenues_FY2526: 5292257023,
    appropriations_FY2526: 5432560355, endingBalance_FY2526: 375271641,
    minimumReserve_variance: -125646757, minimumReserve_variance_2829: -874113032,
    cashReserve_endingBalance: 828032779, revenueGrowth_adjusted: '5.8%', appropriationGrowth: '0.3%',
  },
  cashReserveHistory: [
    { fy: 'FY15-16', end: 730655108 }, { fy: 'FY16-17', end: 680655108 },
    { fy: 'FY17-18', end: 339990065 }, { fy: 'FY18-19', end: 333549124 },
    { fy: 'FY19-20', end: 426307702 }, { fy: 'FY20-21', end: 466964202 },
    { fy: 'FY21-22', end: 927523568 }, { fy: 'FY22-23', end: 1637852563 },
    { fy: 'FY23-24', end: 912817475 }, { fy: 'FY24-25', end: 877079779 },
    { fy: 'FY25-26', end: 828032779, est: true }, { fy: 'FY26-27', end: 546032779, est: true },
    { fy: 'FY27-28', end: 496032779, est: true }, { fy: 'FY28-29', end: 446032779, est: true },
  ],
  gfTransfers: [
    { target: 'School Property Tax Relief Fund', amount: 780000000, pct: 45.4, note: 'LB 34 (2024 Sp. Session)' },
    { target: 'Property Tax Credit Fund', amount: 422000000, pct: 24.6, note: 'Property Tax Credit Act' },
    { target: 'Community College Future Fund', amount: 271446476, pct: 15.8, note: 'LB 243 (2023)' },
    { target: 'Education Future Fund', amount: 242000000, pct: 14.1, note: 'Constitutional allocation' },
    { target: 'Other', amount: 910476, pct: 0.1, note: 'Various' },
  ],
  transfersOutHistory: [
    { fy: '17-18', total: 233 }, { fy: '18-19', total: 230 }, { fy: '19-20', total: 286 },
    { fy: '20-21', total: 310 }, { fy: '21-22', total: 440 }, { fy: '22-23', total: 518 },
    { fy: '23-24', total: 1399 }, { fy: '24-25', total: 1694 },
    { fy: '25-26', total: 1716, est: true }, { fy: '26-27', total: 1755, est: true },
  ],
  agencies: [
    { id: '25', name: 'Health & Human Services', appropriation: 2023307450, cash_fund: 1004105058 },
    { id: '13', name: 'Dept of Education', appropriation: 1344047035, cash_fund: 439959029 },
    { id: '51', name: 'University of Nebraska', appropriation: 703683768, cash_fund: 520587275 },
    { id: '46', name: 'Correctional Services', appropriation: 370355826, cash_fund: 15886125 },
    { id: '05', name: 'Supreme Court', appropriation: 239362551, cash_fund: 17921210 },
    { id: '16', name: 'Dept of Revenue', appropriation: 193621887, cash_fund: 1278731534 },
    { id: '83', name: 'Community Colleges', appropriation: 119116711, cash_fund: 265988849 },
    { id: '64', name: 'State Patrol', appropriation: 90972703, cash_fund: 31801017 },
    { id: '50', name: 'State Colleges', appropriation: 75078448, cash_fund: 47058529 },
    { id: '28', name: 'Veterans Affairs', appropriation: 56368794, cash_fund: 16099266 },
    { id: '72', name: 'Econ Development', appropriation: 25474002, cash_fund: 160639626 },
    { id: '84', name: 'Water, Energy & Env', appropriation: 16301749, cash_fund: 122145750 },
    { id: '33', name: 'Game & Parks', appropriation: 8385147, cash_fund: 125382875 },
    { id: '27', name: 'Transportation', appropriation: 0, cash_fund: 1296868226 },
  ],
  funds: [
    { id: '10000', balance: 684986521.50, interest: -1710205.85, delta: -45000000, title: 'NEBRASKA GENERAL FUND', approp: 5432560355, expended: 3200000000, description: 'The primary operating fund of the State. Receives major tax revenues (income, sales) not earmarked for specific purposes.', statutory_authority: 'Neb. Rev. Stat. §77-2715 et seq.', history: [{ m: 'Aug', b: 850 }, { m: 'Sep', b: 810 }, { m: 'Oct', b: 790 }, { m: 'Nov', b: 730 }, { m: 'Dec', b: 684 }] },
    { id: '11000', balance: 877079779.40, interest: -2189805.09, delta: 12500000, title: 'CASH RESERVE FUND', description: "Also known as the 'Rainy Day Fund.' Cushions the state against downturns and revenue shortfalls.", statutory_authority: 'Neb. Rev. Stat. §84-612.', history: [{ m: 'Aug', b: 820 }, { m: 'Sep', b: 830 }, { m: 'Oct', b: 850 }, { m: 'Nov', b: 864 }, { m: 'Dec', b: 877 }] },
    { id: '22970', balance: 616289506.30, interest: -1538690.01, delta: -1200000, title: 'PERKINS CO CANAL PROJECT FUND', approp: 620000000, expended: 3700000, description: 'Design, engineering, and construction of the Perkins County Canal per the South Platte River Compact.', statutory_authority: 'Section 61-305.', agency_name: 'Water, Energy & Environment', program: '319', history: [{ m: 'Aug', b: 620 }, { m: 'Sep', b: 619 }, { m: 'Oct', b: 618 }, { m: 'Nov', b: 617 }, { m: 'Dec', b: 616 }] },
    { id: '40000', balance: 142500000, interest: 0, delta: 85000000, title: 'FEDERAL GRANTS CLEARING', approp: 2100000000, expended: 1650000000, description: 'Holding account for federal grant drawdowns before distribution to sub-recipient agencies.', history: [{ m: 'Aug', b: 10 }, { m: 'Sep', b: 45 }, { m: 'Oct', b: 30 }, { m: 'Nov', b: 57 }, { m: 'Dec', b: 142 }] },
    { id: '60100', balance: 312500000, interest: -780250, delta: 8400000, title: 'NE INVESTMENT COUNCIL', description: 'Manages state trust and pension investment portfolios under fiduciary oversight.', history: [{ m: 'Aug', b: 290 }, { m: 'Sep', b: 295 }, { m: 'Oct', b: 300 }, { m: 'Nov', b: 304 }, { m: 'Dec', b: 312 }] },
    { id: '22640', balance: 12775373, interest: -31895, delta: -2100000, title: 'HEALTH CARE CASH FUND', approp: 64844630, expended: 56437686, description: 'Health programs as determined by the Legislature. Funded by Tobacco Settlement transfers.', statutory_authority: 'Section 71-7611.', agency_name: 'DHHS', history: [{ m: 'Aug', b: 18 }, { m: 'Sep', b: 16 }, { m: 'Oct', b: 15 }, { m: 'Nov', b: 14 }, { m: 'Dec', b: 12 }] },
    { id: '23290', balance: 73280617, interest: -183003, delta: 4200000, title: 'NE ENVIRONMENTAL TRUST FUND', approp: 15190788, expended: 12452079, description: 'Carrying out the Nebraska Environmental Trust Act. Funded by 44.5% of lottery proceeds.', statutory_authority: 'Section 81-15,174.', agency_name: 'Game and Parks', history: [{ m: 'Aug', b: 68 }, { m: 'Sep', b: 69 }, { m: 'Oct', b: 70 }, { m: 'Nov', b: 71 }, { m: 'Dec', b: 73 }] },
    { id: '22585', balance: 19989375, interest: -49916, delta: -8000000, title: 'MEDICAID MCE EXCESS PROFIT FUND', approp: 22458273, expended: 22458273, description: 'Excess profits from Medicaid managed care contractors.', statutory_authority: 'Section 68-995.', agency_name: 'DHHS', history: [{ m: 'Aug', b: 34 }, { m: 'Sep', b: 30 }, { m: 'Oct', b: 26 }, { m: 'Nov', b: 22 }, { m: 'Dec', b: 19 }] },
    { id: '20580', balance: 5524961.53, interest: -13794, delta: 450000, title: 'PROBATION PROGRAM CASH FUND', description: 'Utilized by the Probation Administrator for community corrections and juvenile services.', statutory_authority: 'Section 29-2262.07.', agency_name: 'Supreme Court', program: '420, 435 & 437', history: [{ m: 'Aug', b: 4.8 }, { m: 'Sep', b: 5.0 }, { m: 'Oct', b: 5.1 }, { m: 'Nov', b: 5.3 }, { m: 'Dec', b: 5.5 }] },
  ],
  fundDescriptions: {
    '20300': { title: 'NE LEG SHARED INFO SYSTEM CASH', agency_name: 'Legislative Council', program: '122', description: 'Sale of electronic copies of statutes and bills. Transfers to GF authorized.', statutory_authority: 'Section 50-437.', ending_balance: 118651 },
    '20470': { title: 'NE COMPETITIVE TELEPHONE MARKET', agency_name: 'Public Service Commission', description: 'Monitor competitive performance of CenturyLink. LFO balance: $232.', statutory_authority: 'Section 86-144.', ending_balance: 232 },
    '21215': { title: 'MUNICIPAL NAT GAS EMERGENCY ASSIST', agency_name: 'State Treasurer', description: 'Grants to municipalities under the Municipal Natural Gas System Emergency Assistance Act.', ending_balance: 0 },
    '21335': { title: 'HIGH SCHOOL EQUIVALENCE FUND', agency_name: 'Dept of Education', description: 'Grants to entities offering high school equivalency programs. LFO balance: $1.', ending_balance: 1 },
    '25450': { title: 'WILLA CATHER NATL STATUARY HALL', agency_name: 'Historical Society', description: 'Purchase/design of Willa Cather statue in National Statuary Hall. Project completed.', ending_balance: 0 },
    '20460': { title: 'INTERNET ENHANCEMENT FUND', agency_name: 'Public Service Commission', description: 'Financial assistance for installing internet infrastructure in counties/municipalities.', ending_balance: 0 },
    '25130': { title: 'FINANCIAL LITERACY CASH FUND', agency_name: 'University of Nebraska', description: 'Assistance to nonprofits for financial literacy programs. Sunset provision triggered. LFO balance: $183,786.', statutory_authority: 'Sunset triggered.', ending_balance: 183786 },
  },
};

/* ═══════════════════ FORMATTERS ═══════════════════ */

function fmt(v) { if (v == null || isNaN(v)) return '$0'; return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(Number(v)); }
function fmtC(v) { if (v == null || isNaN(v)) return '$0'; const n = Number(v), a = Math.abs(n); if (a >= 1e9) return `$${(n / 1e9).toFixed(2)}B`; if (a >= 1e6) return `$${(n / 1e6).toFixed(1)}M`; if (a >= 1e3) return `$${(n / 1e3).toFixed(0)}K`; return fmt(n); }
function fmtP(d) { return isNaN(d) ? '0%' : `${(d * 100).toFixed(1)}%`; }
function getCat(id) { return { 1: 'General', 2: 'Cash', 3: 'Construction', 4: 'Federal', 5: 'Revolving', 6: 'Trust', 7: 'Distributive', 8: 'Suspense' }[String(id || '').charAt(0)] || 'Unknown'; }

/* ═══════════════════ CSV EXPORT ═══════════════════ */

function downloadCsv(filename, headers, rows) {
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = [headers.join(','), ...rows.map((r) => r.map(esc).join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

/* ═══════════════════ NORMALIZE ═══════════════════ */

function normalizeData(raw) {
  const safe = raw || {};
  const fd = safe.fundDescriptions || {};
  const seen = new Map();

  (safe.funds || []).forEach((f) => {
    seen.set(String(f.id), {
      id: String(f.id), title: f.title || `Fund ${f.id}`,
      balance: Number(f.balance ?? 0) || 0, interest: Number(f.interest ?? 0) || 0,
      delta: Number(f.delta ?? 0) || 0, approp: Number(f.approp ?? 0) || 0, expended: Number(f.expended ?? 0) || 0,
      description: f.description || '', statutory_authority: f.statutory_authority || '',
      agency_name: f.agency_name || '', program: f.program || '',
      history: f.history || [], ending_balance: null, category: getCat(f.id), dormant: false,
    });
  });

  Object.entries(fd).forEach(([id, desc]) => {
    if (seen.has(id)) return;
    seen.set(id, {
      id, title: desc.title || `Fund ${id}`, balance: 0, interest: 0, delta: 0, approp: 0, expended: 0,
      description: desc.description || '', statutory_authority: desc.statutory_authority || '',
      agency_name: desc.agency_name || '', program: desc.program || '', history: [],
      ending_balance: desc.ending_balance ?? null, category: getCat(id), dormant: true,
    });
  });

  const funds = [...seen.values()].sort((a, b) => a.dormant !== b.dormant ? (a.dormant ? 1 : -1) : b.balance - a.balance);

  const rs = safe.revenue || {};
  const revenue = {
    period: rs.period || '', nefabBasis: rs.nefabBasis || safe.lastUpdated?.nefab || '',
    ytdActual: Number(rs.ytdActual ?? 0) || 0, ytdForecast: Number(rs.ytdForecast ?? 0) || 0,
    categories: (rs.categories || []).map((c) => ({ name: c.name || '', actual: Number(c.actual ?? 0) || 0, forecast: Number(c.forecast ?? 0) || 0 })),
    nefabForecasts: rs.nefabForecasts || [],
    monthlySeries: (rs.monthlySeries || []).map((m) => ({ month: m.month, actual: Number(m.actual ?? 0) || 0, forecast: Number(m.forecast ?? 0) || 0 })),
  };

  return { ...safe, funds, revenue, macro: { totalBalance: safe.macro?.totalBalance || 0, totalInterest: safe.macro?.totalInterest || 0, effectiveYield: safe.macro?.effectiveYield || 'N/A', activeFunds: safe.macro?.activeFunds || 0, dormantFunds: funds.filter((f) => f.dormant).length, totalFunds: funds.length } };
}

/* ═══════════════════ SHARED COMPONENTS ═══════════════════ */

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

/* ═══════════════════ WATERFALL CHART ═══════════════════ */

function WaterfallChart({ beginBal, revenues, transfers, appropriations, endBal }) {
  // Recharts doesn't have a native waterfall, so we build one with stacked bars:
  // Each bar has an invisible "base" and a visible "value" segment.
  const steps = [
    { name: 'Beginning\nBalance', val: beginBal, color: C.navy },
    { name: 'Net\nRevenues', val: revenues, color: C.emerald },
    { name: 'Transfers\nOut', val: transfers, color: C.amber },
    { name: 'Approp-\nriations', val: appropriations, color: C.red },
    { name: 'Ending\nBalance', val: endBal, color: endBal >= 0 ? C.navy : C.red },
  ];

  // Compute running total for base positioning
  let running = 0;
  const chartData = steps.map((s, i) => {
    if (i === 0 || i === steps.length - 1) {
      // Start and end bars sit on zero
      const d = { name: s.name, base: s.val >= 0 ? 0 : s.val, value: Math.abs(s.val), color: s.color };
      running = s.val;
      return d;
    }
    const base = Math.min(running, running + s.val);
    const value = Math.abs(s.val);
    const d = { name: s.name, base, value, color: s.color };
    running += s.val;
    return d;
  });

  // Convert to billions for Y axis
  const data = chartData.map((d) => ({ ...d, base: d.base / 1e9, value: d.value / 1e9 }));

  // 3% minimum reserve line
  const minReserve = (endBal + Math.abs(rawData.generalFundStatus.minimumReserve_variance)) / 1e9;

  return (
    <div style={{ height: 280 }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} barSize={50}>
          <CartesianGrid vertical={false} strokeDasharray="3 3" stroke={C.s200} />
          <XAxis dataKey="name" tick={{ fill: C.s500, fontSize: 10, whiteSpace: 'pre-line' }} axisLine={false} tickLine={false} interval={0} height={40} />
          <YAxis tick={{ fill: C.s500, fontSize: 10 }} axisLine={false} tickLine={false} width={40} tickFormatter={(v) => `$${v.toFixed(1)}B`} />
          <ReTooltip formatter={(v, name) => name === 'base' ? null : `$${v.toFixed(2)}B`} />
          <Bar dataKey="base" stackId="a" fill="transparent" />
          <Bar dataKey="value" stackId="a" radius={[4, 4, 0, 0]}>
            {data.map((d, i) => <Cell key={i} fill={d.color} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ═══════════════════ TAB: OVERVIEW ═══════════════════ */

function OverviewTab({ data, onNav }) {
  const featured = data.funds.filter((f) => !f.dormant).slice(0, 3);
  const gainers = data.funds.filter((f) => f.delta > 0).sort((a, b) => b.delta - a.delta).slice(0, 4);
  const losers = data.funds.filter((f) => f.delta < 0).sort((a, b) => a.delta - b.delta).slice(0, 4);
  const stalled = data.funds.filter((f) => f.approp > 10000000 && f.expended > 0 && f.expended / f.approp < 0.1);

  return <div style={{ display: 'grid', gap: 18 }}>
    <Narrative>
      Nebraska manages <strong>{fmtC(data.macro.totalBalance)}</strong> across {data.macro.totalFunds || 1502} state funds.
      The General Fund's ending balance is projected at {fmtC(data.generalFundStatus.endingBalance_FY2526)} — <strong>{fmt(Math.abs(data.generalFundStatus.minimumReserve_variance))} below</strong> the constitutional minimum reserve.
      The Cash Reserve Fund, which peaked at $1.64 billion in 2023, is being drawn down to cover the gap.
    </Narrative>

    <div style={{ ...card, background: `linear-gradient(135deg, ${C.navy}, ${C.navyMid}, ${C.navyLight})`, color: '#fff', padding: 26 }}>
      <div style={{ fontSize: 11, color: C.goldLight, textTransform: 'uppercase', letterSpacing: 1.8 }}><InfoTip label="Statewide cash position" body="Weighted ADB across all 1,502 OIP funds. Dormant LFO-only funds are in the Fund Explorer for reference." /></div>
      <div style={{ fontSize: 42, fontWeight: 900, marginTop: 8 }}>{fmtC(data.macro.totalBalance)}</div>
      <div className="metric-grid" style={{ marginTop: 20 }}>
        {[{ l: 'Pool interest', v: fmt(Math.abs(data.macro.totalInterest)) }, { l: 'Yield', v: data.macro.effectiveYield }, { l: 'Active', v: data.macro.activeFunds }, { l: 'Dormant', v: data.macro.dormantFunds }].map((s) => <div key={s.l}><div style={{ fontSize: 11, color: 'rgba(255,255,255,.6)', textTransform: 'uppercase', letterSpacing: 1.3 }}>{s.l}</div><div style={{ fontSize: 20, fontWeight: 800, marginTop: 3 }}>{s.v}</div></div>)}
      </div>
    </div>

    {(gainers.length > 0 || losers.length > 0) && <div style={{ ...panel, borderLeft: `4px solid ${C.gold}` }}>
      <div style={{ fontWeight: 800, color: C.navy, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}><Clock style={{ width: 16, height: 16 }} /> What changed this month</div>
      <div className="two-col">{[{ label: 'Largest gains', items: gainers }, { label: 'Largest drawdowns', items: losers }].map((sec) => <div key={sec.label}><div style={{ fontSize: 11, color: C.s500, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>{sec.label}</div>{sec.items.map((f) => <div key={f.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: `1px solid ${C.s100}` }}><div><span style={{ fontSize: 12.5, fontWeight: 600 }}>{f.title}</span><span style={{ fontSize: 10.5, color: C.s400, marginLeft: 6 }}>#{f.id}</span></div><Delta value={f.delta} compact /></div>)}</div>)}</div>
    </div>}

    {/* Stalled projects callout */}
    {stalled.length > 0 && <div style={{ ...panel, borderLeft: `4px solid ${C.red}`, background: C.redDim }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <AlertTriangle style={{ width: 18, height: 18, color: '#DC2626', marginTop: 2, flexShrink: 0 }} />
        <div style={{ fontSize: 13, color: '#7F1D1D', lineHeight: 1.7 }}>
          <strong>Stalled appropriations:</strong> {stalled.map((f, i) => <span key={f.id}>{i > 0 && ', '}<button type="button" onClick={() => onNav('funds', f.id)} style={{ font: 'inherit', border: 'none', background: 'none', color: '#991B1B', cursor: 'pointer', textDecoration: 'underline', padding: 0 }}>{f.title}</button> ({fmtP(f.expended / f.approp)} of {fmtC(f.approp)} spent)</span>)}. Funds with over $10M appropriated and less than 10% disbursed.
        </div>
      </div>
    </div>}

    <div className="metric-grid">
      <MetricCard label="GF ending balance" value={fmtC(data.generalFundStatus.endingBalance_FY2526)} sub={<Delta value={data.generalFundStatus.endingBalance_FY2526 - data.generalFundStatus.beginningBalance_FY2526} compact />} />
      <MetricCard label="Cash Reserve" value={fmtC(data.generalFundStatus.cashReserve_endingBalance)} />
      <MetricCard label="Min reserve variance" value={fmtC(data.generalFundStatus.minimumReserve_variance)} sub={<Badge text="Below target" color="#991B1B" bg="rgba(239,68,68,.12)" />} />
      <MetricCard label="GF net revenues" value={fmtC(data.generalFundStatus.netRevenues_FY2526)} />
    </div>

    <div className="three-col">{featured.map((f) => <button key={f.id} type="button" onClick={() => onNav('funds', f.id)} style={{ ...panel, textAlign: 'left', cursor: 'pointer', borderLeft: `4px solid ${f.delta >= 0 ? C.emerald : C.red}` }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}><div><div style={{ fontSize: 11, color: C.s500, textTransform: 'uppercase', letterSpacing: 1.2 }}>Fund {f.id}</div><div style={{ fontSize: 15, fontWeight: 800, color: C.navy, marginTop: 5 }}>{f.title}</div></div><Spark data={f.history} positive={f.delta >= 0} /></div>
      <div style={{ fontSize: 25, fontWeight: 900, marginTop: 10 }}>{fmtC(f.balance)}</div>
      <div style={{ marginTop: 8 }}><Delta value={f.delta} compact /></div>
      {f.approp > 0 && <div style={{ marginTop: 12 }}><PBar pct={f.expended / f.approp} color={C.navyLight} height={5} label={`${fmtP(f.expended / f.approp)} of ${fmtC(f.approp)} appropriated`} /></div>}
    </button>)}</div>

    {data.macro.dormantFunds > 0 && <div style={{ ...panel, borderLeft: `4px solid ${C.amber}`, background: C.amberDim }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}><Ghost style={{ width: 18, height: 18, color: '#D97706', marginTop: 2, flexShrink: 0 }} /><div style={{ fontSize: 13, color: '#92400E', lineHeight: 1.7 }}><strong>{data.macro.dormantFunds} dormant funds</strong> (42.7% of all OIP accounts) hold zero balance. Senators may wish to review these for refunding or formal elimination. <button type="button" onClick={() => onNav('funds', null, true)} style={{ font: 'inherit', background: 'none', border: 'none', color: '#B45309', cursor: 'pointer', textDecoration: 'underline', padding: 0 }}>View dormant funds →</button></div></div>
    </div>}
  </div>;
}

/* ═══════════════════ TAB: REVENUE ═══════════════════ */

function RevenueTab({ revenue }) {
  const v = revenue.ytdActual - revenue.ytdForecast;
  if (revenue.ytdActual === 0 && revenue.monthlySeries.length === 0) return <div style={panel}>No revenue data yet.</div>;

  return <div style={{ display: 'grid', gap: 18 }}>
    <Narrative>
      Year-to-date General Fund receipts are <strong>{fmtC(revenue.ytdActual)}</strong>, running {v >= 0 ? `${fmtC(v)} above` : `${fmtC(Math.abs(v))} below`} the NEFAB certified forecast.
      {revenue.nefabBasis && <> The current comparison uses the <strong>{revenue.nefabBasis}</strong> forecast — the Board meets next in April 2026.</>}
    </Narrative>

    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 12 }}>
      <div><div style={{ fontSize: 20, fontWeight: 900, color: C.navy }}>General Fund Net Receipts</div></div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        {revenue.nefabBasis && <Badge text={`NEFAB: ${revenue.nefabBasis}`} color={C.navyMid} bg={C.goldDim} />}
        <ExportBtn onClick={() => downloadCsv('ne_revenue_monthly.csv', ['Month', 'Actual', 'Forecast'], revenue.monthlySeries.map((m) => [m.month, m.actual, m.forecast]))} />
      </div>
    </div>

    <div style={{ display: 'grid', gap: 14, gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
      <MetricCard label="YTD actual" value={fmtC(revenue.ytdActual)} sub={<Delta value={v} compact />} />
      <MetricCard label="YTD forecast" value={fmtC(revenue.ytdForecast)} />
      <MetricCard label="Report period" value={revenue.period || 'Unknown'} />
    </div>

    <div className="two-col">
      <div style={panel}>
        <div style={{ fontWeight: 800, color: C.navy, marginBottom: 14 }}>Monthly net receipts vs. forecast</div>
        <div style={{ height: 260 }}><ResponsiveContainer width="100%" height="100%"><BarChart data={revenue.monthlySeries} barGap={4}>
          <CartesianGrid vertical={false} strokeDasharray="3 3" stroke={C.s200} />
          <XAxis dataKey="month" tick={{ fill: C.s500, fontSize: 11 }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fill: C.s500, fontSize: 11 }} axisLine={false} tickLine={false} width={48} tickFormatter={(v) => `$${Math.round(v / 1e6)}M`} />
          <ReTooltip formatter={(v) => fmt(v)} />
          <Bar dataKey="forecast" fill={C.s200} radius={[4, 4, 0, 0]} name="Forecast" />
          <Bar dataKey="actual" radius={[4, 4, 0, 0]} name="Actual">{revenue.monthlySeries.map((d, i) => <Cell key={i} fill={d.actual >= d.forecast ? C.emerald : C.amber} />)}</Bar>
        </BarChart></ResponsiveContainer></div>
      </div>
      <div style={panel}>
        <div style={{ fontWeight: 800, color: C.navy, marginBottom: 14 }}>YTD category comparison</div>
        <div style={{ display: 'grid', gap: 12 }}>{revenue.categories.map((c) => {
          const cv = c.actual - c.forecast, pct = c.forecast > 0 ? c.actual / c.forecast : 0;
          return <div key={c.name} style={{ borderBottom: `1px solid ${C.s100}`, paddingBottom: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}><div style={{ fontWeight: 700, color: C.s800 }}>{c.name}</div><Delta value={cv} compact /></div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: C.s500, marginBottom: 8 }}><span>Actual: {fmtC(c.actual)}</span><span>Forecast: {fmtC(c.forecast)}</span></div>
            <PBar pct={pct} color={c.actual >= c.forecast ? C.emerald : C.amber} height={6} />
          </div>;
        })}</div>
      </div>
    </div>

    {revenue.nefabForecasts.length > 0 && <div style={panel}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <div><div style={{ fontWeight: 800, color: C.navy }}>NEFAB full-year forecasts</div><div style={{ fontSize: 12.5, color: C.s500, marginTop: 2 }}>Table 3, 2026 Biennial Budget — NEFAB {revenue.nefabBasis}</div></div>
        <ExportBtn onClick={() => downloadCsv('ne_nefab_forecasts.csv', ['Category', 'FY25-26', 'FY26-27', 'Growth'], revenue.nefabForecasts.map((c) => [c.name, c.fy2526, c.fy2627, c.growth]))} />
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead><tr style={{ borderBottom: `2px solid ${C.s200}` }}>{['Category', 'FY25-26', 'FY26-27', 'Adj Growth'].map((h) => <th key={h} style={{ textAlign: h === 'Category' ? 'left' : 'right', padding: '8px 0', fontSize: 10, fontWeight: 700, color: C.s400, textTransform: 'uppercase', letterSpacing: 1 }}>{h}</th>)}</tr></thead>
        <tbody>{revenue.nefabForecasts.map((c) => <tr key={c.name} style={{ borderBottom: `1px solid ${C.s100}` }}>
          <td style={{ padding: '10px 0', fontWeight: 600 }}>{c.name}</td><td style={{ padding: '10px 0', textAlign: 'right' }}>{fmtC(c.fy2526)}</td><td style={{ padding: '10px 0', textAlign: 'right' }}>{fmtC(c.fy2627)}</td>
          <td style={{ padding: '10px 0', textAlign: 'right', color: String(c.growth).startsWith('-') ? C.red : C.emerald, fontWeight: 600 }}>{c.growth}</td>
        </tr>)}<tr style={{ fontWeight: 700, borderTop: `2px solid ${C.navy}` }}><td style={{ padding: '10px 0' }}>Total</td><td style={{ padding: '10px 0', textAlign: 'right' }}>{fmtC(revenue.nefabForecasts.reduce((s, c) => s + (c.fy2526 || 0), 0))}</td><td style={{ padding: '10px 0', textAlign: 'right' }}>{fmtC(revenue.nefabForecasts.reduce((s, c) => s + (c.fy2627 || 0), 0))}</td><td /></tr></tbody>
      </table>
    </div>}
  </div>;
}

/* ═══════════════════ TAB: GF STATUS ═══════════════════ */

function GFStatusTab({ data }) {
  const st = data.generalFundStatus;
  const xfrs = data.gfTransfers || [];
  const table = data.gfStatusTable || [];
  const crH = (data.cashReserveHistory || []).map((d) => ({ ...d, bal: d.end / 1e6 }));
  const xfrH = data.transfersOutHistory || [];
  const fys = ['fy2425', 'fy2526', 'fy2627', 'fy2728', 'fy2829'];
  const fyL = ['FY24-25\nActual', 'FY25-26', 'FY26-27', 'FY27-28\nEst', 'FY28-29\nEst'];

  return <div style={{ display: 'grid', gap: 18 }}>
    <Narrative>
      Nebraska's General Fund is projected to run a <strong>deficit of {fmt(Math.abs(table.find((r) => r.label === 'Ending Balance')?.fy2728 || 0))}</strong> by FY2027-28.
      The state's rainy day fund, which peaked at $1.64 billion in 2023, is being drawn down to cover the gap — from {fmtC(877079779)} today to a projected {fmtC(446032779)} by FY2028-29.
    </Narrative>

    <div style={{ ...panel, borderLeft: `4px solid ${C.red}`, background: C.redDim }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}><AlertTriangle style={{ width: 18, height: 18, color: '#DC2626', marginTop: 2, flexShrink: 0 }} /><div style={{ fontSize: 13, color: '#7F1D1D', lineHeight: 1.7 }}>Current biennium: <strong>{fmt(Math.abs(st.minimumReserve_variance))} below</strong> the 3% minimum reserve.{st.minimumReserve_variance_2829 && <> Following biennium: <strong>{fmt(Math.abs(st.minimumReserve_variance_2829))} shortfall</strong> projected.</>}</div></div>
    </div>

    {/* WATERFALL CHART */}
    <div style={panel}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <div><div style={{ fontWeight: 800, color: C.navy }}>FY2025-26 General Fund flow</div><div style={{ fontSize: 12, color: C.s500, marginTop: 2 }}>How money moves through the General Fund this fiscal year</div></div>
      </div>
      <WaterfallChart beginBal={st.beginningBalance_FY2526} revenues={st.netRevenues_FY2526} transfers={-Math.abs(table.find((r) => r.label.includes('Transfers'))?.fy2526 || 1716331476)} appropriations={-Math.abs(st.appropriations_FY2526)} endBal={st.endingBalance_FY2526} />
    </div>

    {/* 5-year table */}
    {table.length > 0 && <div style={{ ...card, overflowX: 'auto' }}>
      <div style={{ padding: '14px 18px', fontWeight: 800, color: C.navy, borderBottom: `1px solid ${C.s200}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span>General Fund Financial Status</span>
        <ExportBtn onClick={() => downloadCsv('ne_gf_status.csv', ['Line Item', ...fyL.map((l) => l.replace('\n', ' '))], table.map((r) => [r.label, ...fys.map((k) => r[k])]))} />
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5, minWidth: 680 }}>
        <thead><tr style={{ background: C.navy, color: '#fff' }}><th style={{ textAlign: 'left', padding: '10px 14px', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1 }}>Line item</th>{fyL.map((h) => <th key={h} style={{ textAlign: 'right', padding: '10px 14px', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, whiteSpace: 'pre-line' }}>{h}</th>)}</tr></thead>
        <tbody>{table.map((row, idx) => { const hl = row.label.includes('Ending') || row.label.includes('Appropriation'); return <tr key={row.label} style={{ background: hl ? C.goldDim : idx % 2 === 0 ? C.s50 : '#fff', borderBottom: `1px solid ${C.s100}`, fontWeight: hl ? 700 : 400 }}><td style={{ padding: '9px 14px', color: C.navy }}>{row.label}</td>{fys.map((k) => { const v = row[k]; return <td key={k} style={{ padding: '9px 14px', textAlign: 'right', color: v < 0 ? C.red : C.s800 }}>{v < 0 ? `(${fmt(Math.abs(v))})` : fmt(v)}</td>; })}</tr>; })}</tbody>
      </table>
    </div>}

    <div className="two-col">
      {crH.length > 0 && <div style={panel}>
        <div style={{ fontWeight: 800, color: C.navy, marginBottom: 4 }}>Cash Reserve Fund — historical</div>
        <div style={{ fontSize: 12.5, color: C.s500, marginBottom: 14 }}>Peak: $1.64B (FY22-23). Dashed = estimates.</div>
        <div style={{ height: 220 }}><ResponsiveContainer width="100%" height="100%"><AreaChart data={crH}>
          <defs><linearGradient id="crG" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={C.navy} stopOpacity={.12} /><stop offset="100%" stopColor={C.navy} stopOpacity={.01} /></linearGradient></defs>
          <CartesianGrid vertical={false} strokeDasharray="3 3" stroke={C.s200} /><XAxis dataKey="fy" tick={{ fill: C.s500, fontSize: 10 }} axisLine={false} tickLine={false} interval={1} /><YAxis tick={{ fill: C.s500, fontSize: 10 }} axisLine={false} tickLine={false} width={50} tickFormatter={(v) => `$${v}M`} />
          <ReTooltip formatter={(v) => `$${v.toFixed(0)}M`} /><Area type="monotone" dataKey="bal" stroke={C.navy} strokeWidth={2.5} fill="url(#crG)" dot={{ r: 3, fill: C.gold, stroke: C.navy, strokeWidth: 2 }} />
        </AreaChart></ResponsiveContainer></div>
      </div>}

      {xfrs.length > 0 && <div style={panel}>
        <div style={{ fontWeight: 800, color: C.navy, marginBottom: 4 }}>Transfers-out (FY25-26)</div>
        <div style={{ fontSize: 12.5, color: C.s500, marginBottom: 12 }}>Total: {fmt(xfrs.reduce((s, t) => s + t.amount, 0))}</div>
        {xfrs.map((t, i) => <div key={t.target} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: i < xfrs.length - 1 ? `1px solid ${C.s100}` : 'none' }}>
          <div><div style={{ fontWeight: 600, fontSize: 13 }}>{t.target}</div><div style={{ fontSize: 11, color: C.s400, marginTop: 1 }}>{t.note}</div></div>
          <div style={{ textAlign: 'right' }}><div style={{ fontWeight: 700, fontSize: 14 }}>{fmtC(t.amount)}</div>{t.pct && <div style={{ fontSize: 10, color: C.s400 }}>{t.pct}%</div>}</div>
        </div>)}
      </div>}
    </div>

    {xfrH.length > 0 && <div style={panel}>
      <div style={{ fontWeight: 700, color: C.s500, fontSize: 12, marginBottom: 10 }}>Historical transfers-out ($M) — from $233M (FY17-18) to $1.7B (FY25-26)</div>
      <div style={{ height: 150 }}><ResponsiveContainer width="100%" height="100%"><BarChart data={xfrH}><CartesianGrid vertical={false} strokeDasharray="3 3" stroke={C.s200} /><XAxis dataKey="fy" tick={{ fill: C.s500, fontSize: 10 }} axisLine={false} tickLine={false} /><YAxis tick={{ fill: C.s500, fontSize: 10 }} axisLine={false} tickLine={false} width={40} /><ReTooltip formatter={(v) => `$${v}M`} /><Bar dataKey="total" radius={[4, 4, 0, 0]}>{xfrH.map((d, i) => <Cell key={i} fill={d.est ? C.s300 : C.navy} />)}</Bar></BarChart></ResponsiveContainer></div>
    </div>}
  </div>;
}

/* ═══════════════════ TAB: AGENCIES ═══════════════════ */

function AgenciesTab({ agencies }) {
  const sorted = [...agencies].sort((a, b) => (b.appropriation + b.cash_fund) - (a.appropriation + a.cash_fund));
  const totalGF = sorted.reduce((s, a) => s + a.appropriation, 0);

  return <div style={{ display: 'grid', gap: 12 }}>
    <Narrative>
      Nebraska appropriates <strong>{fmtC(totalGF)}</strong> in General Fund dollars across {sorted.length} major agencies — about <strong>${Math.round(totalGF / NE_POP).toLocaleString()} per resident</strong>.
      Health & Human Services alone accounts for {fmtP(sorted[0].appropriation / totalGF)} of all GF spending, or ${Math.round(sorted[0].appropriation / NE_POP).toLocaleString()} per Nebraskan.
    </Narrative>

    <div style={{ ...panel, borderLeft: `4px solid ${C.blue}`, background: C.blueDim }}>
      <div style={{ fontSize: 13, color: '#1E3A5F', lineHeight: 1.6 }}>
        <strong>Reading this data:</strong>{' '}
        <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: C.navy, verticalAlign: 'middle', marginRight: 3 }} /> General Fund (Legislature-controlled) vs.{' '}
        <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: C.goldLight, verticalAlign: 'middle', marginLeft: 6, marginRight: 3 }} /> Cash Fund (earmarked fees/federal).
        Transportation ($0 GF, $1.3B CF) operates entirely on highway user fees.
      </div>
    </div>

    <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
      <ExportBtn onClick={() => downloadCsv('ne_agency_appropriations.csv', ['Agency ID', 'Name', 'GF Appropriation', 'Cash Fund', 'Total', 'Per Capita GF'], sorted.map((a) => [a.id, a.name, a.appropriation, a.cash_fund, a.appropriation + a.cash_fund, Math.round(a.appropriation / NE_POP)]))} />
    </div>

    {sorted.map((a) => {
      const total = a.appropriation + a.cash_fund, share = total > 0 ? a.appropriation / total : 0;
      const perCap = Math.round(a.appropriation / NE_POP);
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
          <div><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: C.navy, marginRight: 4 }} />GF: {fmt(a.appropriation)} ({fmtP(share)})</div>
          <div><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: C.goldLight, marginRight: 4 }} />CF: {fmt(a.cash_fund)}</div>
        </div>
      </div>;
    })}
  </div>;
}

/* ═══════════════════ TAB: FUND EXPLORER ═══════════════════ */

function FundsTab({ funds, selectedId, onSelect, showDormantInit = false }) {
  const [rawSearch, setRawSearch] = useState('');
  const search = useDebounce(rawSearch);
  const [showDormant, setShowDormant] = useState(showDormantInit);
  const [cat, setCat] = useState('All');

  const cats = ['All', ...new Set(funds.map((f) => f.category))];
  const filtered = funds.filter((f) => {
    if (!showDormant && f.dormant) return false;
    if (cat !== 'All' && f.category !== cat) return false;
    const hay = `${f.title} ${f.description} ${f.statutory_authority} ${f.agency_name}`.toLowerCase();
    return !search || hay.includes(search.toLowerCase()) || f.id.includes(search);
  });
  const sel = filtered.find((f) => f.id === selectedId) || null;
  const dCt = funds.filter((f) => f.dormant).length;

  return <div className="fund-layout">
    <div style={card}>
      <div style={{ padding: 18, borderBottom: `1px solid ${C.s200}`, background: C.s50 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ fontWeight: 800, color: C.navy }}>Fund Explorer</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" onClick={() => setShowDormant((v) => !v)} style={{ border: `1px solid ${showDormant ? C.amber : C.s300}`, background: showDormant ? C.amberDim : '#fff', color: showDormant ? '#92400E' : C.s700, borderRadius: 8, padding: '6px 11px', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}><Ghost style={{ width: 14, height: 14 }} />{showDormant ? `Dormant (${dCt})` : 'Show dormant'}</button>
            <ExportBtn onClick={() => downloadCsv('ne_funds.csv', ['ID', 'Title', 'Category', 'Balance', 'Interest', 'MoM Delta', 'Dormant', 'Agency', 'Statute'], filtered.map((f) => [f.id, f.title, f.category, f.balance, f.interest, f.delta, f.dormant, f.agency_name, f.statutory_authority]))} />
          </div>
        </div>
        <div style={{ position: 'relative', marginTop: 12 }}><Search style={{ width: 15, height: 15, color: C.s400, position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)' }} /><input value={rawSearch} onChange={(e) => setRawSearch(e.target.value)} placeholder="Search funds, agencies, statutes..." style={{ width: '100%', padding: '10px 12px 10px 32px', borderRadius: 10, border: `1px solid ${C.s300}`, background: '#fff' }} /></div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 12 }}>{cats.map((c) => <button key={c} type="button" onClick={() => setCat(c)} style={{ border: cat === c ? 'none' : `1px solid ${C.s300}`, background: cat === c ? C.navy : '#fff', color: cat === c ? '#fff' : C.s700, borderRadius: 999, padding: '5px 10px', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>{c}</button>)}</div>
        <div style={{ marginTop: 10, fontSize: 11, color: C.s500 }}>{filtered.length} fund{filtered.length !== 1 ? 's' : ''} · <span style={{ color: C.emerald }}>{filtered.filter((f) => !f.dormant && f.balance > 0).length} active</span>{showDormant && <> · <span style={{ color: C.amber }}>{filtered.filter((f) => f.dormant).length} dormant</span></>}</div>
      </div>
      <div style={{ maxHeight: 640, overflowY: 'auto' }}>{filtered.map((f) => <button key={f.id} type="button" onClick={() => onSelect(f.id)} style={{ width: '100%', border: 'none', background: sel?.id === f.id ? '#EFF6FF' : f.dormant ? C.amberDim : '#fff', borderBottom: `1px solid ${C.s100}`, borderLeft: sel?.id === f.id ? `3px solid ${C.navy}` : '3px solid transparent', padding: 14, textAlign: 'left', cursor: 'pointer' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 14, alignItems: 'flex-start' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>{f.dormant && <Ghost style={{ width: 13, height: 13, color: '#D97706', flexShrink: 0 }} />}<div><div style={{ fontSize: 12.5, fontWeight: 700, color: f.dormant ? '#92400E' : C.navy }}>{f.title}</div><div style={{ fontSize: 10.5, color: C.s400, marginTop: 2 }}>#{f.id} · {f.category}{f.agency_name ? ` · ${f.agency_name}` : ''}</div></div></div>
          <div style={{ textAlign: 'right', flexShrink: 0 }}>{f.dormant ? <Badge text="DORMANT" color="#92400E" bg="rgba(245,158,11,.14)" /> : <><div style={{ fontWeight: 800, fontSize: 13 }}>{fmtC(f.balance)}</div>{f.delta !== 0 && <div style={{ marginTop: 4 }}><Delta value={f.delta} compact /></div>}</>}</div>
        </div>
      </button>)}{filtered.length === 0 && <div style={{ padding: 40, textAlign: 'center', color: C.s400 }}>No funds match.</div>}</div>
    </div>

    <div>{sel ? <div style={{ ...card, position: 'sticky', top: 72 }}>
      <div style={{ padding: 20, background: `linear-gradient(135deg, ${sel.dormant ? '#92400E' : C.navy}, ${sel.dormant ? '#B45309' : C.navyMid})`, color: '#fff', display: 'flex', justifyContent: 'space-between', gap: 14, alignItems: 'flex-start' }}>
        <div><div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}><div style={{ fontSize: 11, color: sel.dormant ? '#FDE68A' : C.goldLight, textTransform: 'uppercase', letterSpacing: 1.3 }}>Fund {sel.id} · {sel.category}</div>{sel.dormant && <Badge text="DORMANT" color="#FDE68A" bg="rgba(253,230,138,.14)" />}</div><div style={{ fontSize: 18, fontWeight: 900, marginTop: 6 }}>{sel.title}</div></div>
        <button type="button" onClick={() => onSelect(null)} style={{ border: 'none', background: 'rgba(255,255,255,.12)', color: '#fff', borderRadius: 8, padding: 6, cursor: 'pointer' }}><X style={{ width: 15, height: 15 }} /></button>
      </div>
      <div style={{ padding: 20 }}>
        {sel.history?.length > 1 && !sel.dormant && <div style={{ marginBottom: 18, background: C.s50, borderRadius: 8, padding: 10, border: `1px solid ${C.s100}` }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: C.s400, textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 6 }}>5-month cash trend ($M)</div>
          <div style={{ height: 90 }}><ResponsiveContainer width="100%" height="100%"><AreaChart data={sel.history}><defs><linearGradient id="dG" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={sel.delta >= 0 ? C.emerald : C.red} stopOpacity={.2} /><stop offset="100%" stopColor={sel.delta >= 0 ? C.emerald : C.red} stopOpacity={0} /></linearGradient></defs>
          <XAxis dataKey="m" tick={{ fill: C.s400, fontSize: 10 }} axisLine={false} tickLine={false} /><ReTooltip formatter={(v) => `$${v}M`} /><Area type="monotone" dataKey="b" stroke={sel.delta >= 0 ? C.emerald : C.red} strokeWidth={2.5} fill="url(#dG)" dot={{ r: 3, fill: C.gold, stroke: sel.delta >= 0 ? C.emerald : C.red, strokeWidth: 2 }} /></AreaChart></ResponsiveContainer></div>
        </div>}
        {sel.description && <div style={{ fontSize: 13, color: C.s700, lineHeight: 1.7, marginBottom: 18 }}>{sel.description}</div>}
        {sel.dormant && <div style={{ background: C.redDim, border: '1px solid #FECACA', borderRadius: 8, padding: 12, marginBottom: 18 }}>
          <div style={{ fontSize: 12.5, color: '#7F1D1D', lineHeight: 1.7, fontWeight: 600, display: 'flex', alignItems: 'flex-start', gap: 6 }}><AlertTriangle style={{ width: 14, height: 14, marginTop: 2, flexShrink: 0 }} /><span>Legislative action recommended: Zero OIP balance. {sel.ending_balance > 0 ? `LFO reports ${fmt(sel.ending_balance)} — verify and consider transfer to GF or formal elimination.` : 'Consider formal elimination via statute repeal.'}</span></div>
        </div>}
        <div style={{ display: 'grid', gap: 8 }}>{[
          ['Current balance', sel.dormant ? 'Dormant — $0 in OIP' : fmt(sel.balance)],
          ...(sel.delta && !sel.dormant ? [['Month-over-month', (sel.delta >= 0 ? '+' : '') + fmt(sel.delta)]] : []),
          ['Statutory authority', sel.statutory_authority || 'Not provided'],
          ['Agency', sel.agency_name || 'N/A'], ['Program', sel.program || 'N/A'],
          ...(sel.approp > 0 ? [['SFY appropriation', fmt(sel.approp)], ['SFY expended', fmt(sel.expended)], ['Remaining authority', fmt(sel.approp - sel.expended)]] : []),
          ...(sel.dormant && sel.ending_balance != null ? [['LFO reported balance', fmt(sel.ending_balance)]] : []),
        ].map(([l, v]) => <div key={l} style={{ display: 'flex', justifyContent: 'space-between', gap: 14, fontSize: 12.5, borderBottom: `1px solid ${C.s100}`, paddingBottom: 7 }}><div style={{ color: C.s500 }}>{l}</div><div style={{ fontWeight: 700, color: C.s800, textAlign: 'right' }}>{v}</div></div>)}</div>
        {sel.approp > 0 && !sel.dormant && <div style={{ marginTop: 14 }}><div style={{ fontSize: 10, fontWeight: 700, color: C.s400, textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 6 }}>Appropriation burn rate</div><PBar pct={sel.expended / sel.approp} color={sel.expended / sel.approp > 0.9 ? C.red : C.navyLight} height={8} label={`${fmtC(sel.approp - sel.expended)} remaining`} /></div>}
      </div>
    </div> : <div style={{ ...panel, display: 'grid', placeItems: 'center', minHeight: 260, textAlign: 'center', color: C.s500 }}><div><FileText style={{ width: 34, height: 34, margin: '0 auto 10px', color: C.s300 }} /><div style={{ fontWeight: 800, color: C.s700 }}>No fund selected</div><div style={{ marginTop: 6, fontSize: 13 }}>Choose a fund for details, description, and appropriation chain.</div></div></div>}</div>
  </div>;
}

/* ═══════════════════ TAB: REFERENCE ═══════════════════ */

function ReferenceTab() {
  const secs = [
    { t: 'Fund Types', items: [{ t: 'General Fund (10000)', d: 'All receipts not earmarked by statute. Funded by income/sales taxes. 48 of 79 agencies receive GF support.' }, { t: 'Cash Funds (20000s)', d: 'Dedicated fees and charges. 300+ individual funds across 75 agencies. Money restricted to statutory purpose.' }, { t: 'Federal Funds (40000s)', d: 'Grants, contracts, matching funds from the federal government. Appropriations are estimates.' }, { t: 'Revolving Funds (50000s)', d: 'Interagency transactions — one agency provides goods/services to another.' }, { t: 'Trust Funds (60000s)', d: 'Fiduciary funds held for individuals/entities (pensions, settlements, unclaimed property).' }, { t: 'Dormant Fund', d: 'Zero OIP cash balance. May still have statutory authorization. Should be reviewed for elimination or refunding.' }] },
    { t: 'Budget Terms', items: [{ t: 'Average Daily Balance (ADB)', d: 'Weighted average cash held in a fund over the month. Basis for pro-rata interest allocation.' }, { t: 'NEFAB', d: 'Nebraska Economic Forecasting Advisory Board. Sets official revenue forecasts. Meets 3×/year (Oct, Feb, Apr).' }, { t: 'Minimum Reserve', d: 'Constitutionally required 3% ending balance for the GF at biennium end.' }, { t: 'State Fiscal Year', d: 'July 1 – June 30. FY2025-26 = July 1, 2025 to June 30, 2026.' }, { t: 'Per Capita', d: `Dollar amounts divided by Nebraska's estimated population (${(NE_POP / 1e6).toFixed(2)}M, 2024 Census).` }] },
    { t: 'Data Sources', items: [{ t: 'OIP Report', d: 'Monthly from DAS State Accounting. ADB and interest for all ~1,500 funds.' }, { t: 'Biennial Budget Report', d: 'Appropriations Committee per session. GF status, agency appropriations, revenue forecasts, transfers.' }, { t: 'GF Financial Status', d: 'Live at nebraskalegislature.gov, updated by LFO during session. 5-year GF balance sheet.' }, { t: 'LFO Directory', d: 'Annual from Legislative Fiscal Office. Statutory authority, revenue sources, permitted uses for every fund.' }, { t: 'Revenue News Release', d: 'Monthly from Dept of Revenue. Gross/net receipts by category vs. NEFAB certified forecast.' }] },
  ];
  return <div style={{ display: 'grid', gap: 18 }}><div><div style={{ fontSize: 20, fontWeight: 900, color: C.navy }}>Reference & Definitions</div></div>
    {secs.map((sec) => <div key={sec.t} style={panel}><div style={{ fontWeight: 800, color: C.navy, marginBottom: 12 }}>{sec.t}</div>{sec.items.map((i) => <div key={i.t} style={{ padding: '10px 0', borderBottom: `1px solid ${C.s100}` }}><div style={{ fontWeight: 700, fontSize: 13, color: C.s800, marginBottom: 3 }}>{i.t}</div><div style={{ fontSize: 12.5, color: C.s500, lineHeight: 1.7 }}>{i.d}</div></div>)}</div>)}
    <div style={{ ...panel, background: C.goldDim, borderLeft: `4px solid ${C.gold}` }}><div style={{ fontSize: 12.5, color: '#713F12', lineHeight: 1.7 }}><strong>Authoritative URLs:</strong>{' '}<a href="https://nebraskalegislature.gov/reports/fiscal.php" target="_blank" rel="noreferrer" style={{ color: C.navyMid }}>Legislature Fiscal Reports</a> · <a href="https://revenue.nebraska.gov/research/statistics" target="_blank" rel="noreferrer" style={{ color: C.navyMid }}>Revenue Statistics</a> · <a href="https://das.nebraska.gov/accounting/financial_reports.php" target="_blank" rel="noreferrer" style={{ color: C.navyMid }}>DAS Accounting</a></div></div>
  </div>;
}

/* ═══════════════════ APP SHELL + HASH ROUTING ═══════════════════ */

export default function NebraskaBudgetDashboard() {
  const data = useMemo(() => normalizeData(rawData), []);

  // Hash routing: #tab or #tab/fundId
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
        button, input { font: inherit; }
        input:focus, button:focus-visible { outline: 2px solid ${C.gold}; outline-offset: 1px; }
      `}</style>

      <header style={{ background: `linear-gradient(135deg, ${C.navy}, ${C.navyMid}, ${C.navyLight})`, color: '#fff' }}>
        <div className="page-wrap" style={{ paddingTop: 18, paddingBottom: 18, display: 'flex', justifyContent: 'space-between', gap: 18, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{ width: 42, height: 42, borderRadius: 10, background: 'rgba(201,168,76,.12)', display: 'grid', placeItems: 'center', border: '1px solid rgba(201,168,76,.24)' }}><Landmark style={{ width: 22, height: 22, color: C.gold }} /></div>
            <div><div style={{ fontSize: 20, fontWeight: 900 }}>Nebraska Public Budget Dashboard</div><div style={{ fontSize: 11, color: C.goldLight, letterSpacing: 2, textTransform: 'uppercase', marginTop: 2 }}>Cash pool · Revenue · Appropriations · Fund accountability</div></div>
          </div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,.68)', lineHeight: 1.7 }}>
            <div>Cash: <span style={{ color: '#fff' }}>{data.lastUpdated?.cash}</span></div>
            <div>Budget: <span style={{ color: '#fff' }}>{data.lastUpdated?.budget}</span></div>
            {data.lastUpdated?.nefab && <div>NEFAB: <span style={{ color: '#fff' }}>{data.lastUpdated.nefab}</span></div>}
          </div>
        </div>
      </header>

      <nav style={{ background: '#fff', borderBottom: `1px solid ${C.s200}`, position: 'sticky', top: 0, zIndex: 10 }}>
        <div className="page-wrap" style={{ display: 'flex', gap: 4, overflowX: 'auto' }}>
          {TABS.map((t) => { const a = tab === t.id, I = t.icon; return <button key={t.id} type="button" onClick={() => navigate(t.id)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '14px 16px', border: 'none', borderBottom: `3px solid ${a ? C.gold : 'transparent'}`, background: 'transparent', color: a ? C.navy : C.s500, fontWeight: a ? 800 : 600, cursor: 'pointer', whiteSpace: 'nowrap' }}><I style={{ width: 14, height: 14 }} />{t.label}</button>; })}
        </div>
      </nav>

      <main className="page-wrap" style={{ paddingTop: 24, paddingBottom: 24 }}>
        {tab === 'overview' && <OverviewTab data={data} onNav={navigate} />}
        {tab === 'revenue' && <RevenueTab revenue={data.revenue} />}
        {tab === 'gfstatus' && <GFStatusTab data={data} />}
        {tab === 'agencies' && <AgenciesTab agencies={data.agencies} />}
        {tab === 'funds' && <FundsTab funds={data.funds} selectedId={selectedFundId} onSelect={selectFund} showDormantInit={showDormantInit} />}
        {tab === 'reference' && <ReferenceTab />}
      </main>

      <footer style={{ borderTop: `1px solid ${C.s200}`, padding: '14px 24px', textAlign: 'center', fontSize: 11, color: C.s400 }}>
        Data: NE DAS State Accounting · NE Dept of Revenue · NE Legislative Fiscal Office · Appropriations Committee, 109th Legislature
      </footer>
    </div>
  );
}

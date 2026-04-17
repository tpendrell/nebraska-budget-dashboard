import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  BookOpen,
  Building2,
  Database,
  Download,
  FileText,
  Ghost,
  PieChart,
  Scale,
  Search,
  TrendingUp,
  X,
} from 'lucide-react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip as ReTooltip,
  XAxis,
  YAxis,
} from 'recharts';

const C = {
  navy: '#0F2440',
  navyMid: '#1A3A5C',
  navyLight: '#264E78',
  gold: '#C9A84C',
  goldLight: '#E8D59A',
  goldDim: 'rgba(201,168,76,.10)',
  emerald: '#10B981',
  emeraldDim: 'rgba(16,185,129,.08)',
  red: '#EF4444',
  redDim: 'rgba(239,68,68,.08)',
  amber: '#F59E0B',
  amberDim: 'rgba(245,158,11,.08)',
  blue: '#3B82F6',
  blueDim: '#EFF6FF',
  s50: '#F8FAFC',
  s100: '#F1F5F9',
  s200: '#E2E8F0',
  s300: '#CBD5E1',
  s400: '#94A3B8',
  s500: '#64748B',
  s700: '#334155',
  s800: '#1E293B',
  s900: '#0F172A',
};

const card = {
  background: '#fff',
  borderRadius: 14,
  border: `1px solid ${C.s200}`,
  overflow: 'hidden',
};

const panel = {
  ...card,
  padding: 22,
};

const TABS = [
  { id: 'overview', icon: PieChart, label: 'Overview' },
  { id: 'revenue', icon: TrendingUp, label: 'Revenue' },
  { id: 'gfstatus', icon: Scale, label: 'GF Status' },
  { id: 'agencies', icon: Building2, label: 'Agencies' },
  { id: 'funds', icon: Database, label: 'Fund Explorer' },
  { id: 'reference', icon: BookOpen, label: 'Reference' },
];

const NE_POP = 1970000;

const DATA_URL =
  'https://script.google.com/macros/s/AKfycbxdhapah1CYnlo6GBH3vpstAxJx8JRzxenkDc45t_4qa5W306HY1m_Ft841nwHJs_x1/exec';

function fmt(v) {
  if (v == null || Number.isNaN(Number(v))) return '$0';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(Number(v));
}

function fmtC(v) {
  if (v == null || Number.isNaN(Number(v))) return '$0';
  const n = Number(v);
  const a = Math.abs(n);
  if (a >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  return fmt(n);
}

function fmtP(d) {
  const n = Number(d);
  if (Number.isNaN(n)) return '0%';
  return `${(n * 100).toFixed(1)}%`;
}

function getCat(id) {
  return {
    1: 'General',
    2: 'Cash',
    3: 'Construction',
    4: 'Federal',
    5: 'Revolving',
    6: 'Trust',
    7: 'Distributive',
    8: 'Suspense',
  }[String(id || '').charAt(0)] || 'Unknown';
}

function downloadCsv(filename, headers, rows) {
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = [headers.join(','), ...rows.map((r) => r.map(esc).join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 100);
}

function normalizeData(raw) {
  const safe = raw || {};
  const fd = safe.fundDescriptions || {};
  const seen = new Map();

  (safe.funds || []).forEach((f) => {
    const id = String(f.id);
    seen.set(id, {
      id,
      title: f.title || `Fund ${id}`,
      balance: Number(f.balance ?? 0) || 0,
      interest: Number(f.interest ?? 0) || 0,
      delta: Number(f.delta ?? 0) || 0,
      approp: Number(f.approp ?? 0) || 0,
      expended: Number(f.expended ?? 0) || 0,
      description: f.description || '',
      statutory_authority: f.statutory_authority || '',
      agency_name: f.agency_name || '',
      program: f.program || '',
      history: Array.isArray(f.history) ? f.history : [],
      ending_balance: f.ending_balance ?? null,
      category: getCat(id),
      dormant: false,
    });
  });

  Object.entries(fd).forEach(([id, desc]) => {
    const sId = String(id);
    if (seen.has(sId)) {
      const existing = seen.get(sId);
      if (!existing.description && desc.description) existing.description = desc.description;
      if (!existing.statutory_authority && desc.statutory_authority) {
        existing.statutory_authority = desc.statutory_authority;
      }
      if (!existing.agency_name && desc.agency_name) existing.agency_name = desc.agency_name;
      if (!existing.program && desc.program) existing.program = desc.program;
      if (!existing.title && desc.title) existing.title = desc.title;
      if (existing.ending_balance == null && desc.ending_balance != null) {
        existing.ending_balance = desc.ending_balance;
      }
    } else {
      seen.set(sId, {
        id: sId,
        title: desc.title || `Fund ${sId}`,
        balance: 0,
        interest: 0,
        delta: 0,
        approp: 0,
        expended: 0,
        description: desc.description || '',
        statutory_authority: desc.statutory_authority || '',
        agency_name: desc.agency_name || '',
        program: desc.program || '',
        history: [],
        ending_balance: desc.ending_balance ?? null,
        category: getCat(sId),
        dormant: true,
      });
    }
  });

  seen.forEach((f) => {
    if (!f.dormant && f.balance === 0 && (f.approp || 0) === 0) {
      f.dormant = true;
    }
  });

  const funds = [...seen.values()].sort((a, b) => {
    if (a.dormant !== b.dormant) return a.dormant ? 1 : -1;
    return b.balance - a.balance;
  });

  const rs = safe.revenue || {};
  const revenue = {
    period: rs.period || '',
    nefabBasis: rs.nefabBasis || safe.lastUpdated?.nefab || '',
    ytdActual: Number(rs.ytdActual ?? 0) || 0,
    ytdForecast: Number(rs.ytdForecast ?? 0) || 0,
    categories: (rs.categories || []).map((c) => ({
      name: c.name || '',
      actual: Number(c.actual ?? 0) || 0,
      forecast: Number(c.forecast ?? 0) || 0,
    })),
    nefabForecasts: rs.nefabForecasts || [],
    monthlySeries: (rs.monthlySeries || []).map((m) => ({
      month: m.month,
      actual: Number(m.actual ?? 0) || 0,
      forecast: Number(m.forecast ?? 0) || 0,
    })),
  };

  const generalFundStatus = {
    beginningBalance_FY2526: 0,
    netRevenues_FY2526: 0,
    appropriations_FY2526: 0,
    endingBalance_FY2526: 0,
    minimumReserve_variance: 0,
    minimumReserve_variance_2829: 0,
    cashReserve_endingBalance: 0,
    ...(safe.generalFundStatus || {}),
  };

  return {
    ...safe,
    funds,
    revenue,
    generalFundStatus,
    gfStatusTable: safe.gfStatusTable || [],
    cashReserveHistory: safe.cashReserveHistory || [],
    transfersOutHistory: safe.transfersOutHistory || [],
    gfTransfers: safe.gfTransfers || [],
    agencies: safe.agencies || [],
    lastUpdated: safe.lastUpdated || {},
    macro: {
      totalBalance: safe.macro?.totalBalance || 0,
      totalInterest: safe.macro?.totalInterest || 0,
      effectiveYield: safe.macro?.effectiveYield || 'N/A',
      activeFunds: safe.macro?.activeFunds || 0,
      dormantFunds: funds.filter((f) => f.dormant).length,
      totalFunds: funds.length,
    },
  };
}

function Badge({ text, color = C.navy, bg = C.goldDim }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: '2px 10px',
        borderRadius: 999,
        fontSize: 10,
        fontWeight: 700,
        color,
        background: bg,
        letterSpacing: 0.4,
      }}
    >
      {text}
    </span>
  );
}

function Delta({ value, compact }) {
  if (!value || Number.isNaN(Number(value)) || Number(value) === 0) return null;
  const n = Number(value);
  const positive = n > 0;
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: '3px 8px',
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 700,
        color: positive ? '#059669' : '#DC2626',
        background: positive ? C.emeraldDim : C.redDim,
      }}
    >
      {positive ? '+' : '-'}
      {compact ? fmtC(Math.abs(n)) : fmt(Math.abs(n))}
    </span>
  );
}

function MetricCard({ label, value, sub }) {
  return (
    <div style={panel}>
      <div style={{ fontSize: 11, color: C.s500, textTransform: 'uppercase', letterSpacing: 1.2 }}>
        {label}
      </div>
      <div style={{ fontSize: 28, fontWeight: 900, color: C.navy, marginTop: 6 }}>{value}</div>
      {sub && <div style={{ marginTop: 8 }}>{sub}</div>}
    </div>
  );
}

function ExportBtn({ onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        border: `1px solid ${C.s300}`,
        background: '#fff',
        borderRadius: 6,
        padding: '4px 10px',
        cursor: 'pointer',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        fontSize: 11,
        color: C.s500,
        fontWeight: 600,
      }}
    >
      <Download style={{ width: 12, height: 12 }} />
      CSV
    </button>
  );
}

function Narrative({ children }) {
  return (
    <div style={{ fontSize: 14, color: C.s700, lineHeight: 1.8, marginBottom: 20 }}>
      {children}
    </div>
  );
}

function OverviewTab({ data, onNav }) {
  const featured = data.funds.filter((f) => !f.dormant).slice(0, 3);
  const gfs = data.generalFundStatus;

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <Narrative>
        Nebraska manages <strong>{fmtC(data.macro.totalBalance)}</strong> across{' '}
        <strong>{data.macro.totalFunds}</strong> state funds.
      </Narrative>

      <div
        style={{
          ...card,
          background: `linear-gradient(135deg, ${C.navy}, ${C.navyMid}, ${C.navyLight})`,
          color: '#fff',
          padding: 26,
        }}
      >
        <div style={{ fontSize: 11, color: C.goldLight, textTransform: 'uppercase', letterSpacing: 1.8 }}>
          Statewide cash position
        </div>
        <div style={{ fontSize: 42, fontWeight: 900, marginTop: 8 }}>{fmtC(data.macro.totalBalance)}</div>
        <div
          style={{
            marginTop: 20,
            display: 'grid',
            gap: 16,
            gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
          }}
        >
          <div>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,.65)', textTransform: 'uppercase' }}>Pool interest</div>
            <div style={{ fontSize: 20, fontWeight: 800, marginTop: 4 }}>{fmt(Math.abs(data.macro.totalInterest))}</div>
          </div>
          <div>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,.65)', textTransform: 'uppercase' }}>Yield</div>
            <div style={{ fontSize: 20, fontWeight: 800, marginTop: 4 }}>{data.macro.effectiveYield}</div>
          </div>
          <div>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,.65)', textTransform: 'uppercase' }}>Active</div>
            <div style={{ fontSize: 20, fontWeight: 800, marginTop: 4 }}>{data.macro.activeFunds}</div>
          </div>
          <div>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,.65)', textTransform: 'uppercase' }}>Dormant</div>
            <div style={{ fontSize: 20, fontWeight: 800, marginTop: 4 }}>{data.macro.dormantFunds}</div>
          </div>
        </div>
      </div>

      <div
        style={{
          display: 'grid',
          gap: 16,
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
        }}
      >
        <MetricCard label="GF ending balance" value={fmtC(gfs.endingBalance_FY2526)} />
        <MetricCard label="Cash Reserve" value={fmtC(gfs.cashReserve_endingBalance)} />
        <MetricCard
          label="Min reserve variance"
          value={fmtC(gfs.minimumReserve_variance)}
          sub={
            gfs.minimumReserve_variance < 0 ? (
              <Badge text="Below target" color="#991B1B" bg="rgba(239,68,68,.12)" />
            ) : null
          }
        />
        <MetricCard label="GF net revenues" value={fmtC(gfs.netRevenues_FY2526)} />
      </div>

      <div
        style={{
          display: 'grid',
          gap: 16,
          gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
        }}
      >
        {featured.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => onNav('funds', f.id)}
            style={{
              ...panel,
              textAlign: 'left',
              cursor: 'pointer',
              borderLeft: `4px solid ${f.delta >= 0 ? C.emerald : C.red}`,
            }}
          >
            <div style={{ fontSize: 11, color: C.s500, textTransform: 'uppercase', letterSpacing: 1.2 }}>
              Fund {f.id}
            </div>
            <div style={{ fontSize: 15, fontWeight: 800, color: C.navy, marginTop: 6 }}>{f.title}</div>
            <div style={{ fontSize: 26, fontWeight: 900, marginTop: 12 }}>{fmtC(f.balance)}</div>
            <div style={{ marginTop: 8 }}>
              <Delta value={f.delta} compact />
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function RevenueTab({ revenue }) {
  const variance = revenue.ytdActual - revenue.ytdForecast;

  if (revenue.ytdActual === 0 && revenue.monthlySeries.length === 0) {
    return <div style={panel}>No revenue data yet.</div>;
  }

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <Narrative>
        Year-to-date General Fund receipts are <strong>{fmtC(revenue.ytdActual)}</strong>, running{' '}
        <strong>{variance >= 0 ? `${fmtC(variance)} above` : `${fmtC(Math.abs(variance))} below`}</strong> forecast.
      </Narrative>

      <div style={{ display: 'grid', gap: 14, gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
        <MetricCard label="YTD actual" value={fmtC(revenue.ytdActual)} sub={<Delta value={variance} compact />} />
        <MetricCard label="YTD forecast" value={fmtC(revenue.ytdForecast)} />
        <MetricCard label="Report period" value={revenue.period || 'Unknown'} />
      </div>

      {revenue.monthlySeries.length > 0 && (
        <div style={panel}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <div style={{ fontWeight: 800, color: C.navy }}>Monthly net receipts vs forecast</div>
            <ExportBtn
              onClick={() =>
                downloadCsv(
                  'ne_revenue_monthly.csv',
                  ['Month', 'Actual', 'Forecast'],
                  revenue.monthlySeries.map((m) => [m.month, m.actual, m.forecast])
                )
              }
            />
          </div>
          <div style={{ height: 280 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={revenue.monthlySeries}>
                <CartesianGrid vertical={false} strokeDasharray="3 3" stroke={C.s200} />
                <XAxis dataKey="month" tick={{ fill: C.s500, fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis
                  tick={{ fill: C.s500, fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                  width={48}
                  tickFormatter={(v) => `$${Math.round(v / 1e6)}M`}
                />
                <ReTooltip formatter={(v) => fmt(v)} />
                <Bar dataKey="forecast" fill={C.s200} radius={[4, 4, 0, 0]} />
                <Bar dataKey="actual" radius={[4, 4, 0, 0]}>
                  {revenue.monthlySeries.map((d, i) => (
                    <Cell key={i} fill={d.actual >= d.forecast ? C.emerald : C.amber} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {revenue.categories.length > 0 && (
        <div style={panel}>
          <div style={{ fontWeight: 800, color: C.navy, marginBottom: 14 }}>YTD category comparison</div>
          <div style={{ display: 'grid', gap: 12 }}>
            {revenue.categories.map((c) => (
              <div key={c.name} style={{ borderBottom: `1px solid ${C.s100}`, paddingBottom: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                  <div style={{ fontWeight: 700, color: C.s800 }}>{c.name}</div>
                  <Delta value={c.actual - c.forecast} compact />
                </div>
                <div style={{ fontSize: 12, color: C.s500 }}>
                  Actual: {fmtC(c.actual)} · Forecast: {fmtC(c.forecast)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function GFStatusTab({ data }) {
  const st = data.generalFundStatus || {};
  const table = data.gfStatusTable || [];
  const crH = (data.cashReserveHistory || []).map((d) => ({
    ...d,
    bal: (d.end || 0) / 1e6,
  }));

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <div style={{ display: 'grid', gap: 14, gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
        <MetricCard label="Beginning balance" value={fmtC(st.beginningBalance_FY2526)} />
        <MetricCard label="Net revenues" value={fmtC(st.netRevenues_FY2526)} />
        <MetricCard label="Appropriations" value={fmtC(st.appropriations_FY2526)} />
        <MetricCard label="Ending balance" value={fmtC(st.endingBalance_FY2526)} />
      </div>

      {table.length > 0 && (
        <div style={{ ...card, overflowX: 'auto' }}>
          <div
            style={{
              padding: '14px 18px',
              fontWeight: 800,
              color: C.navy,
              borderBottom: `1px solid ${C.s200}`,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <span>General Fund Financial Status</span>
            <ExportBtn
              onClick={() =>
                downloadCsv(
                  'ne_gf_status.csv',
                  ['Line Item', 'FY24-25', 'FY25-26', 'FY26-27', 'FY27-28', 'FY28-29'],
                  table.map((r) => [r.label, r.fy2425, r.fy2526, r.fy2627, r.fy2728, r.fy2829])
                )
              }
            />
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5, minWidth: 680 }}>
            <thead>
              <tr style={{ background: C.navy, color: '#fff' }}>
                {['Line item', 'FY24-25', 'FY25-26', 'FY26-27', 'FY27-28', 'FY28-29'].map((h) => (
                  <th
                    key={h}
                    style={{
                      textAlign: h === 'Line item' ? 'left' : 'right',
                      padding: '10px 14px',
                      fontSize: 10,
                      textTransform: 'uppercase',
                      letterSpacing: 1,
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.map((row, idx) => (
                <tr key={`${row.label}-${idx}`} style={{ borderBottom: `1px solid ${C.s100}` }}>
                  <td style={{ padding: '9px 14px', color: C.navy }}>{row.label}</td>
                  {['fy2425', 'fy2526', 'fy2627', 'fy2728', 'fy2829'].map((k) => (
                    <td key={k} style={{ padding: '9px 14px', textAlign: 'right' }}>
                      {row[k] == null ? '—' : fmt(row[k])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {crH.length > 0 && (
        <div style={panel}>
          <div style={{ fontWeight: 800, color: C.navy, marginBottom: 12 }}>Cash Reserve Fund history</div>
          <div style={{ height: 240 }}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={crH}>
                <defs>
                  <linearGradient id="crG" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={C.navy} stopOpacity={0.12} />
                    <stop offset="100%" stopColor={C.navy} stopOpacity={0.01} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} strokeDasharray="3 3" stroke={C.s200} />
                <XAxis dataKey="fy" tick={{ fill: C.s500, fontSize: 10 }} axisLine={false} tickLine={false} />
                <YAxis
                  tick={{ fill: C.s500, fontSize: 10 }}
                  axisLine={false}
                  tickLine={false}
                  width={50}
                  tickFormatter={(v) => `$${v}M`}
                />
                <ReTooltip formatter={(v) => `$${Number(v).toFixed(0)}M`} />
                <Area type="monotone" dataKey="bal" stroke={C.navy} strokeWidth={2.5} fill="url(#crG)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  );
}

function AgenciesTab({ agencies }) {
  if (!agencies || agencies.length === 0) {
    return <div style={panel}>No agency data loaded.</div>;
  }

  const sorted = [...agencies].sort(
    (a, b) => ((b.appropriation || 0) + (b.cash_fund || 0)) - ((a.appropriation || 0) + (a.cash_fund || 0))
  );

  const totalGF = sorted.reduce((s, a) => s + (a.appropriation || 0), 0);

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <Narrative>
        Nebraska appropriates <strong>{fmtC(totalGF)}</strong> in General Fund dollars, about{' '}
        <strong>${Math.round(totalGF / NE_POP).toLocaleString()} per resident</strong>.
      </Narrative>

      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <ExportBtn
          onClick={() =>
            downloadCsv(
              'ne_agency_appropriations.csv',
              ['Agency ID', 'Name', 'GF Appropriation', 'Cash Fund'],
              sorted.map((a) => [a.id, a.name, a.appropriation, a.cash_fund])
            )
          }
        />
      </div>

      {sorted.map((a) => {
        const gf = a.appropriation || 0;
        const cf = a.cash_fund || 0;
        const total = gf + cf;
        const share = total > 0 ? gf / total : 0;

        return (
          <div key={a.id} style={panel}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 14, alignItems: 'flex-start' }}>
              <div>
                <div style={{ fontSize: 11, color: C.s500, textTransform: 'uppercase', letterSpacing: 1.2 }}>
                  Agency {a.id}
                </div>
                <div style={{ fontSize: 15, fontWeight: 800, color: C.navy, marginTop: 4 }}>{a.name}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 22, fontWeight: 900 }}>{fmtC(total)}</div>
                <div style={{ fontSize: 11, color: C.s500 }}>all funds</div>
              </div>
            </div>
            <div
              style={{
                marginTop: 12,
                height: 10,
                background: C.s100,
                borderRadius: 999,
                overflow: 'hidden',
                display: 'flex',
              }}
            >
              <div style={{ width: `${share * 100}%`, background: C.navy }} />
              <div style={{ flex: 1, background: C.goldLight }} />
            </div>
            <div style={{ marginTop: 8, fontSize: 12, color: C.s500 }}>
              GF: {fmt(gf)} · Cash: {fmt(cf)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function FundsTab({ funds, selectedId, onSelect, showDormantInit = false }) {
  const [search, setSearch] = useState('');
  const [showDormant, setShowDormant] = useState(showDormantInit);
  const [cat, setCat] = useState('All');

  useEffect(() => {
    if (showDormantInit) setShowDormant(true);
  }, [showDormantInit]);

  const cats = useMemo(() => ['All', ...new Set(funds.map((f) => f.category))], [funds]);

  const filtered = useMemo(() => {
    return funds.filter((f) => {
      if (!showDormant && f.dormant) return false;
      if (cat !== 'All' && f.category !== cat) return false;
      const hay = `${f.title} ${f.description} ${f.statutory_authority} ${f.agency_name}`.toLowerCase();
      return !search || hay.includes(search.toLowerCase()) || f.id.includes(search);
    });
  }, [funds, showDormant, cat, search]);

  const sel = funds.find((f) => f.id === selectedId) || null;
  const dCt = funds.filter((f) => f.dormant).length;

  return (
    <div
      style={{
        display: 'grid',
        gap: 18,
        gridTemplateColumns: 'minmax(320px, 420px) minmax(0, 1fr)',
        alignItems: 'start',
      }}
    >
      <div style={card}>
        <div style={{ padding: 18, borderBottom: `1px solid ${C.s200}`, background: C.s50 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ fontWeight: 800, color: C.navy }}>Fund Explorer</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                onClick={() => setShowDormant((v) => !v)}
                style={{
                  border: `1px solid ${showDormant ? C.amber : C.s300}`,
                  background: showDormant ? C.amberDim : '#fff',
                  color: showDormant ? '#92400E' : C.s700,
                  borderRadius: 8,
                  padding: '6px 11px',
                  cursor: 'pointer',
                }}
              >
                {showDormant ? `Dormant (${dCt})` : 'Show dormant'}
              </button>
              <ExportBtn
                onClick={() =>
                  downloadCsv(
                    'ne_funds.csv',
                    ['ID', 'Title', 'Category', 'Balance', 'Interest', 'Delta', 'Dormant'],
                    filtered.map((f) => [f.id, f.title, f.category, f.balance, f.interest, f.delta, f.dormant])
                  )
                }
              />
            </div>
          </div>

          <div style={{ position: 'relative', marginTop: 12 }}>
            <Search
              style={{
                width: 15,
                height: 15,
                color: C.s400,
                position: 'absolute',
                left: 10,
                top: '50%',
                transform: 'translateY(-50%)',
              }}
            />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search funds, agencies, statutes..."
              style={{
                width: '100%',
                padding: '10px 12px 10px 32px',
                borderRadius: 10,
                border: `1px solid ${C.s300}`,
                background: '#fff',
              }}
            />
          </div>

          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 12 }}>
            {cats.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setCat(c)}
                style={{
                  border: cat === c ? 'none' : `1px solid ${C.s300}`,
                  background: cat === c ? C.navy : '#fff',
                  color: cat === c ? '#fff' : C.s700,
                  borderRadius: 999,
                  padding: '5px 10px',
                  fontSize: 11,
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                {c}
              </button>
            ))}
          </div>
        </div>

        <div style={{ maxHeight: 640, overflowY: 'auto' }}>
          {filtered.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => onSelect(f.id)}
              style={{
                width: '100%',
                border: 'none',
                background: sel?.id === f.id ? '#EFF6FF' : f.dormant ? C.amberDim : '#fff',
                borderBottom: `1px solid ${C.s100}`,
                borderLeft: sel?.id === f.id ? `3px solid ${C.navy}` : '3px solid transparent',
                padding: 14,
                textAlign: 'left',
                cursor: 'pointer',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 14, alignItems: 'flex-start' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  {f.dormant && <Ghost style={{ width: 13, height: 13, color: '#D97706', flexShrink: 0 }} />}
                  <div>
                    <div style={{ fontSize: 12.5, fontWeight: 700, color: f.dormant ? '#92400E' : C.navy }}>
                      {f.title}
                    </div>
                    <div style={{ fontSize: 10.5, color: C.s400, marginTop: 2 }}>
                      #{f.id} · {f.category}
                    </div>
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  {f.dormant ? (
                    <Badge text="DORMANT" color="#92400E" bg="rgba(245,158,11,.14)" />
                  ) : (
                    <div style={{ fontWeight: 800, fontSize: 13 }}>{fmtC(f.balance)}</div>
                  )}
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>

      <div>
        {sel ? (
          <div style={{ ...card, position: 'sticky', top: 24 }}>
            <div
              style={{
                padding: 20,
                background: `linear-gradient(135deg, ${sel.dormant ? '#92400E' : C.navy}, ${
                  sel.dormant ? '#B45309' : C.navyMid
                })`,
                color: '#fff',
                display: 'flex',
                justifyContent: 'space-between',
                gap: 14,
                alignItems: 'flex-start',
              }}
            >
              <div>
                <div style={{ fontSize: 11, color: sel.dormant ? '#FDE68A' : C.goldLight, textTransform: 'uppercase', letterSpacing: 1.3 }}>
                  Fund {sel.id} · {sel.category}
                </div>
                <div style={{ fontSize: 18, fontWeight: 900, marginTop: 6 }}>{sel.title}</div>
              </div>
              <button
                type="button"
                onClick={() => onSelect(null)}
                style={{
                  border: 'none',
                  background: 'rgba(255,255,255,.12)',
                  color: '#fff',
                  borderRadius: 8,
                  padding: 6,
                  cursor: 'pointer',
                }}
              >
                <X style={{ width: 15, height: 15 }} />
              </button>
            </div>

            <div style={{ padding: 20 }}>
              <div style={{ display: 'grid', gap: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 14, borderBottom: `1px solid ${C.s100}`, paddingBottom: 7 }}>
                  <div style={{ color: C.s500 }}>Balance</div>
                  <div style={{ fontWeight: 700, color: C.s800 }}>{sel.dormant ? 'Dormant — $0 in OIP' : fmt(sel.balance)}</div>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 14, borderBottom: `1px solid ${C.s100}`, paddingBottom: 7 }}>
                  <div style={{ color: C.s500 }}>Statutory authority</div>
                  <div style={{ fontWeight: 700, color: C.s800, textAlign: 'right' }}>
                    {sel.statutory_authority || 'Not provided'}
                  </div>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 14, borderBottom: `1px solid ${C.s100}`, paddingBottom: 7 }}>
                  <div style={{ color: C.s500 }}>Agency</div>
                  <div style={{ fontWeight: 700, color: C.s800 }}>{sel.agency_name || 'N/A'}</div>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 14, borderBottom: `1px solid ${C.s100}`, paddingBottom: 7 }}>
                  <div style={{ color: C.s500 }}>Program</div>
                  <div style={{ fontWeight: 700, color: C.s800 }}>{sel.program || 'N/A'}</div>
                </div>
              </div>

              {sel.description && (
                <div style={{ marginTop: 18 }}>
                  <div style={{ fontSize: 11, color: C.s500, textTransform: 'uppercase', letterSpacing: 1.2 }}>
                    Description
                  </div>
                  <div style={{ marginTop: 8, fontSize: 13.5, lineHeight: 1.75, color: C.s700 }}>{sel.description}</div>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div
            style={{
              ...panel,
              display: 'grid',
              placeItems: 'center',
              minHeight: 260,
              textAlign: 'center',
              color: C.s500,
            }}
          >
            <div>
              <FileText style={{ width: 34, height: 34, margin: '0 auto 10px', color: C.s300 }} />
              <div style={{ fontWeight: 800, color: C.s700 }}>No fund selected</div>
              <div style={{ marginTop: 6, fontSize: 13 }}>Choose a fund for details.</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ReferenceTab() {
  const sections = [
    {
      t: 'Fund Types',
      items: [
        { t: 'General Fund (10000)', d: 'All receipts not earmarked by statute. Funded by income and sales taxes.' },
        { t: 'Cash Funds (20000s)', d: 'Dedicated fees and charges restricted to statutory purpose.' },
        { t: 'Federal Funds (40000s)', d: 'Grants, contracts, and matching funds from the federal government.' },
        { t: 'Revolving Funds (50000s)', d: 'Interagency service transactions.' },
        { t: 'Trust Funds (60000s)', d: 'Fiduciary funds held for individuals or entities.' },
        { t: 'Dormant Fund', d: 'Zero OIP cash balance. Candidate for review or cleanup.' },
      ],
    },
    {
      t: 'Budget Terms',
      items: [
        { t: 'Average Daily Balance (ADB)', d: 'Weighted average cash held in a fund over the month.' },
        { t: 'NEFAB', d: 'Nebraska Economic Forecasting Advisory Board.' },
        { t: 'Minimum Reserve', d: 'Constitutionally required 3% ending balance for the General Fund.' },
        { t: 'Per Capita', d: `Divided by Nebraska's estimated population of ${(NE_POP / 1e6).toFixed(2)}M.` },
      ],
    },
  ];

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <div>
        <div style={{ fontSize: 20, fontWeight: 900, color: C.navy }}>Reference & Definitions</div>
      </div>

      {sections.map((sec) => (
        <div key={sec.t} style={panel}>
          <div style={{ fontWeight: 800, color: C.navy, marginBottom: 12 }}>{sec.t}</div>
          {sec.items.map((i) => (
            <div key={i.t} style={{ padding: '10px 0', borderBottom: `1px solid ${C.s100}` }}>
              <div style={{ fontWeight: 700, fontSize: 13, color: C.s800, marginBottom: 3 }}>{i.t}</div>
              <div style={{ fontSize: 12.5, color: C.s500, lineHeight: 1.7 }}>{i.d}</div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

export default function NebraskaBudgetDashboard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('overview');
  const [selectedFundId, setSelectedFundId] = useState(null);
  const [showDormantInit, setShowDormantInit] = useState(false);

  const parseHash = useCallback(() => {
    const h = window.location.hash.replace('#', '');
    const [t, fid] = h.split('/');
    return {
      tab: TABS.find((x) => x.id === t)?.id || 'overview',
      fundId: fid || null,
    };
  }, []);

  useEffect(() => {
    const p = parseHash();
    setTab(p.tab);
    setSelectedFundId(p.fundId);

    const onHash = () => {
      const next = parseHash();
      setTab(next.tab);
      setSelectedFundId(next.fundId);
    };

    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, [parseHash]);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const url = `${DATA_URL}?t=${Date.now()}`;
        const response = await fetch(url, { cache: 'no-store' });
        if (!response.ok) throw new Error(`Fetch failed: HTTP ${response.status}`);
        const raw = await response.json();
        setData(normalizeData(raw));
      } catch (err) {
        setError(err.message || String(err));
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  const navigate = useCallback((newTab, fundId = null, dormant = false) => {
    setTab(newTab);
    setSelectedFundId(fundId);
    if (dormant) setShowDormantInit(true);
    window.history.replaceState(null, '', `#${newTab}${fundId ? `/${fundId}` : ''}`);
  }, []);

  const renderTab = () => {
    if (!data) return null;

    switch (tab) {
      case 'overview':
        return <OverviewTab data={data} onNav={navigate} />;
      case 'revenue':
        return <RevenueTab revenue={data.revenue} />;
      case 'gfstatus':
        return <GFStatusTab data={data} />;
      case 'agencies':
        return <AgenciesTab agencies={data.agencies} />;
      case 'funds':
        return (
          <FundsTab
            funds={data.funds}
            selectedId={selectedFundId}
            onSelect={(id) => {
              setSelectedFundId(id);
              window.history.replaceState(null, '', id ? `#funds/${id}` : '#funds');
            }}
            showDormantInit={showDormantInit}
          />
        );
      case 'reference':
        return <ReferenceTab />;
      default:
        return <OverviewTab data={data} onNav={navigate} />;
    }
  };

  if (loading) {
    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'grid',
          placeItems: 'center',
          background: C.s50,
          color: C.navy,
          fontFamily: 'Inter, system-ui, sans-serif',
        }}
      >
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 22, fontWeight: 900 }}>Loading dashboard…</div>
          <div style={{ marginTop: 8, color: C.s500 }}>Fetching live budget data</div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div
        style={{
          minHeight: '100vh',
          background: C.s50,
          padding: 24,
          fontFamily: 'Inter, system-ui, sans-serif',
        }}
      >
        <div style={{ ...panel, maxWidth: 840, margin: '80px auto', borderLeft: `4px solid ${C.red}`, background: C.redDim }}>
          <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
            <AlertTriangle style={{ width: 18, height: 18, color: '#DC2626', marginTop: 2 }} />
            <div>
              <div style={{ fontWeight: 800, color: '#7F1D1D' }}>Could not load dashboard data</div>
              <div style={{ marginTop: 8, fontSize: 13, color: '#7F1D1D', lineHeight: 1.7 }}>{error}</div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        background: C.s50,
        color: C.s900,
        fontFamily: 'Inter, system-ui, sans-serif',
      }}
    >
      <style>{`
        * { box-sizing: border-box; }
        body { margin: 0; }
        a { color: inherit; }
        @media (max-width: 980px) {
          .app-shell {
            grid-template-columns: 1fr !important;
          }
        }
        @media (max-width: 1100px) {
          .fund-layout-mobile {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>

      <div
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 30,
          background: 'rgba(248,250,252,.9)',
          backdropFilter: 'blur(8px)',
          borderBottom: `1px solid ${C.s200}`,
        }}
      >
        <div
          style={{
            maxWidth: 1400,
            margin: '0 auto',
            padding: '14px 20px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 16,
            flexWrap: 'wrap',
          }}
        >
          <div>
            <div style={{ fontSize: 22, fontWeight: 900, color: C.navy }}>Nebraska Public Budget Dashboard</div>
            <div style={{ fontSize: 12, color: C.s500, marginTop: 2 }}>
              Cash, General Fund status, agencies, and fund reference
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {TABS.map((t) => {
              const Icon = t.icon;
              const active = tab === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => navigate(t.id)}
                  style={{
                    border: active ? 'none' : `1px solid ${C.s300}`,
                    background: active ? C.navy : '#fff',
                    color: active ? '#fff' : C.s700,
                    borderRadius: 999,
                    padding: '8px 12px',
                    fontSize: 12,
                    fontWeight: 700,
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                  }}
                >
                  <Icon style={{ width: 14, height: 14 }} />
                  {t.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 1400, margin: '0 auto', padding: 20 }}>{renderTab()}</div>
    </div>
  );
}

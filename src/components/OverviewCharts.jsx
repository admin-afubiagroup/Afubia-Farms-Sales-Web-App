import { useMemo, useState } from 'react';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, BarChart, Bar } from 'recharts';
const money = n => new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN', maximumFractionDigits: 0 }).format(Number(n) || 0);
const dayKey = d => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Lagos', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
export default function OverviewCharts({ sales = [] }) {
  const [today] = useState(() => Date.now());
  const { days, products } = useMemo(() => {
    const days = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(today - (6 - i) * 86400000);
      return { date: dayKey(d), day: new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Lagos', weekday: 'short' }).format(d), revenue: 0 };
    });
    const totals = {};
    for (const r of sales) {
      if (['cancelled', 'canceled', 'void', 'deleted'].includes(String(r.status).toLowerCase())) continue;
      const date = String(r.recordDate || (r.createdAt?.toDate ? dayKey(r.createdAt.toDate()) : '')).slice(0, 10);
      const amount = Number(r.totalAmount ?? r.total ?? r.amount) || 0;
      const d = days.find(d => d.date === date);
      if (d) d.revenue += amount;
      const name = r.productName || r.product || 'Other';
      totals[name] = (totals[name] || 0) + amount;
    }
    return { days, products: Object.entries(totals).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name, revenue]) => ({ name, revenue })) };
  }, [sales, today]);
  return <section className="overview-charts" aria-label="Sales charts"><article className="workspace-chart"><span className="section-kicker">LAST 7 DAYS · NIGERIA TIME</span><h2>Sales momentum</h2><p>Daily recorded revenue for the selected shop.</p><div className="workspace-chart-canvas"><ResponsiveContainer width="100%" height="100%"><AreaChart data={days} margin={{ top: 12, right: 16, bottom: 4, left: 0 }}><defs><linearGradient id="revenue-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#164b2f" stopOpacity={.23} /><stop offset="100%" stopColor="#164b2f" stopOpacity={0} /></linearGradient></defs><CartesianGrid strokeDasharray="4 5" vertical={false} stroke="#dfe5df" /><XAxis dataKey="day" axisLine={false} tickLine={false} tickMargin={12} /><YAxis width={65} tickFormatter={n => n >= 1000 ? `${Math.round(n / 1000)}k` : n} axisLine={false} tickLine={false} /><Tooltip formatter={money} /><Area type="monotone" dataKey="revenue" name="Revenue" stroke="#164b2f" strokeWidth={3} fill="url(#revenue-fill)" /></AreaChart></ResponsiveContainer></div><details className="chart-accessible-data"><summary>View chart figures</summary><ul>{days.map(d => <li key={d.date}>{d.date}: {money(d.revenue)}</li>)}</ul></details></article><article className="workspace-chart"><span className="section-kicker">PRODUCT PERFORMANCE · ALL TIME</span><h2>Top products</h2><p>Products ranked by recorded revenue.</p>{products.length ? <div className="workspace-chart-canvas"><ResponsiveContainer width="100%" height="100%"><BarChart data={products} layout="vertical" margin={{ top: 12, right: 18, left: 0, bottom: 4 }}><CartesianGrid strokeDasharray="4 5" horizontal={false} stroke="#dfe5df" /><XAxis type="number" axisLine={false} tickLine={false} tickFormatter={n => n >= 1000 ? `${Math.round(n / 1000)}k` : n} /><YAxis type="category" dataKey="name" width={110} axisLine={false} tickLine={false} tick={{ fontSize: 11 }} /><Tooltip formatter={money} /><Bar dataKey="revenue" name="Revenue" fill="#c89b3c" radius={[0, 5, 5, 0]} barSize={24} /></BarChart></ResponsiveContainer></div> : <div className="chart-empty">Your product chart will appear after the first sale.</div>}<details className="chart-accessible-data"><summary>View product figures</summary><ul>{products.map(p => <li key={p.name}>{p.name}: {money(p.revenue)}</li>)}</ul></details></article></section>;
}

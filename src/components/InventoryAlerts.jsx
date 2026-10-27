import { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { Link } from 'react-router-dom';
import { db } from '../Firebase/firebase.utils';
import { balance, category } from '../../functions/inventory';

export default function InventoryAlerts({ branchId = 'all' }) {
  const [records, setRecords] = useState({});
  const [errors, setErrors] = useState({});
  useEffect(() => {
    const names = ['sales', 'conversions', 'materials', 'shopOpeningStock', 'products'];
    const stops = names.map(name => onSnapshot(collection(db, name), snapshot => {
      setRecords(old => ({ ...old, [name]: snapshot.docs.map(d => ({ id: d.id, ...d.data() })) }));
      setErrors(old => ({ ...old, [name]: '' }));
    }, e => setErrors(old => ({ ...old, [name]: e.message }))));
    return () => stops.forEach(stop => stop());
  }, []);
  const branches = useMemo(() => ['kara', 'ogidan'].filter(id => branchId === 'all' || id === branchId).map(id => {
    const scoped = Object.fromEntries(Object.entries(records).map(([key, values]) => [key, values.filter(r => r.branchId === id)]));
    const current = balance(scoped);
    for (const product of records.products || []) if (category(product) === 'Other' && product.active !== false) current.stock[product.name || product.productName] = (Number(product.openingStockByBranch?.[id]) || 0) + (current.generic[product.id] || 0);
    return { id, ...current };
  }), [records, branchId]);
  const loading = Object.keys(records).length !== 5;
  return <section className="inventory-alerts" aria-labelledby="inventory-alert-heading">
    <div className="workspace-section-title"><div><span className="section-kicker">REPLENISHMENT WATCH</span><h2 id="inventory-alert-heading">Stock & packaging health</h2><p>Live branch balances. Oil alert: 10L or less · Honey: 10 bottles · Packaging: 30 units · Kegs: 2.</p></div><Link to="/admin/materials" className="workspace-link">Buy / record materials →</Link></div>
    {Object.values(errors).some(Boolean) ? <p role="alert">Inventory could not be verified. Check your connection and database permissions.</p> : loading ? <p role="status">Checking current balances…</p> : <div className="inventory-branches">{branches.map(b => <article key={b.id} className="inventory-branch"><h3>{b.id === 'kara' ? 'Kara Shop' : 'Ogidan Shop'}</h3><div className="inventory-chips">{Object.entries(b.stock).map(([name, qty]) => <div key={name} className={`inventory-chip ${qty <= 10 ? 'needs-attention' : ''}`}><span>{name}</span><strong>{Math.max(0, qty).toLocaleString(undefined, { maximumFractionDigits: 2 })} <small>{name === 'Honey' ? 'bottles' : ['Palm Oil', 'Kuli-Kuli Oil'].includes(name) ? 'L' : 'units'}</small></strong><small>{qty <= 0 ? 'Out of stock · sales blocked' : qty <= 10 ? 'Low stock · replenish soon' : 'Available'}</small></div>)}</div><h4>Materials available for turning</h4><div className="inventory-materials">{Object.entries(b.materials).map(([name, qty]) => <p key={name} className={qty <= (name === 'kegs' ? 2 : 30) ? 'low-material' : ''}><span>{name === 'kegs' ? 'Unturned oil kegs' : `${name} empty containers`}</span><strong>{Math.max(0, qty)} {qty <= 0 ? '· Buy before turning' : qty <= (name === 'kegs' ? 2 : 30) ? '· Low' : ''}</strong></p>)}</div>{b.unclassified > 0 && <p className="inventory-note">{b.unclassified} material record(s) are not classified as oil kegs or empty containers. Review these before relying on packaging balances.</p>}<Link to="/admin/shop-stock">Manage opening stock →</Link></article>)}</div>}
  </section>;
}

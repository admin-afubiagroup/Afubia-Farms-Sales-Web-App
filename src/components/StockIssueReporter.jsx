import { useEffect, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { addDoc, collection, doc, getDoc, serverTimestamp } from 'firebase/firestore';
import { auth, db } from '../Firebase/firebase.utils';
import './stock-issue-reporter.css';

const ISSUE_TYPES = [
  ['product_finished', 'Product don finish'],
  ['low_stock', 'Stock dey low'],
  ['missing_kegs', 'Keg no dey'],
  ['missing_containers', 'Empty bottles/containers no dey'],
  ['other', 'Other problem'],
];
const ADMIN_ROLES = ['admin', 'administrator', 'superadmin', 'super_admin'];
const normalizeBranch = value => {
  const branch = String(value || '').trim().toLowerCase().replace(/[_\s]+/g, '-');
  if (['kara', 'kara-shop'].includes(branch)) return { branchId: 'kara', branchName: 'Kara Shop' };
  if (['ogidan', 'ogidan-shop'].includes(branch)) return { branchId: 'ogidan', branchName: 'Ogidan Shop' };
  return { branchId: '', branchName: '' };
};

export default function StockIssueReporter() {
  const [staff, setStaff] = useState(null);
  const [kind, setKind] = useState('product_finished');
  const [productName, setProductName] = useState('Palm Oil');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');

  useEffect(() => onAuthStateChanged(auth, async user => {
    if (!user) { setStaff(null); return; }
    try {
      const snap = await getDoc(doc(db, 'users', user.uid));
      const data = snap.exists() ? snap.data() : {};
      const role = String(data.role || data.userRole || '').toLowerCase();
      if (ADMIN_ROLES.includes(role)) { setStaff(null); return; }
      const branch = normalizeBranch(data.branchId || data.branch || data.branchName);
      setStaff(branch.branchId && ['salesgirl', 'salesperson', 'sales_rep'].includes(role) ? {
        uid: user.uid, staffId: data.staffId || user.uid,
        staffName: data.displayName || data.fullName || data.name || user.displayName || user.email?.split('@')[0] || 'Staff member',
        role, ...branch,
      } : null);
    } catch { setStaff(null); }
  }), []);

  if (!staff) return null;
  async function submit(event) {
    event.preventDefault(); setBusy(true); setStatus(''); setError('');
    try {
      await addDoc(collection(db, 'staffMessages'), {
        userId: staff.uid, staffId: String(staff.staffId), staffName: staff.staffName,
        userRole: staff.role, branchId: staff.branchId, branchName: staff.branchName,
        category: kind, productName: productName.trim(), message: message.trim(),
        status: 'open', createdAt: serverTimestamp(),
      });
      setStatus('Message don go to admin. Thank you!');
      setMessage('');
    } catch (e) {
      console.error('Could not send staff stock report:', e);
      setError('Message no send. Check internet, then try again. If e still no work, tell admin directly.');
    } finally { setBusy(false); }
  }
  return <section className="stock-issue-reporter" aria-labelledby="stock-issue-heading">
    <div className="stock-issue-heading"><span aria-hidden="true">📣</span><div><h2 id="stock-issue-heading">Report problem / message admin</h2><p>Product don finish? Stock dey low? Tell admin from here.</p></div></div>
    <form onSubmit={submit}>
      <label>Wetin happen?
        <select value={kind} onChange={event => setKind(event.target.value)}>
          {ISSUE_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </label>
      <label>Which product or item?
        <input value={productName} onChange={event => setProductName(event.target.value)} maxLength={100} required placeholder="E.g. Palm Oil, 1L bottle" />
      </label>
      <label>Explain small (optional)
        <textarea value={message} onChange={event => setMessage(event.target.value)} maxLength={1000} rows={3} placeholder="E.g. Palm Oil for Kara Shop don finish." />
      </label>
      <button type="submit" disabled={busy}>{busy ? 'E dey send…' : 'Send message to admin'}</button>
    </form>
    {status && <p className="stock-issue-success" role="status">✓ {status}</p>}
    {error && <p className="stock-issue-error" role="alert">{error}</p>}
  </section>;
}

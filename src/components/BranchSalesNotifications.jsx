import { useEffect, useRef, useState } from 'react';
import { collection, query, orderBy, limit, onSnapshot, doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { isSupported } from 'firebase/messaging';
import { db, auth } from '../Firebase/firebase.utils';
import { enableAdminPush, disableAdminPush, watchForegroundPush } from '../Firebase/push';
import './branch-notifications.css';

const labels = {
  sale_recorded: 'Sale recorded', oil_turned: 'Oil turned', sign_in: 'Staff signed in', sign_out: 'Staff signed out',
  staff_message: 'Message from salesperson', stock_low: 'Low / finished stock',
};
const messageLabels = {
  product_finished: 'Product don finish', low_stock: 'Stock dey low', missing_kegs: 'Keg no dey',
  missing_containers: 'Empty containers no dey', other: 'Other staff report',
};
const formatWhen = value => value?.toDate ? new Intl.DateTimeFormat('en-NG', { timeZone: 'Africa/Lagos', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(value.toDate()) : 'Saving…';
const money = value => new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN', maximumFractionDigits: 0 }).format(Number(value) || 0);

export default function BranchSalesNotifications({ branchId = 'all' }) {
  const [records, setRecords] = useState([]);
  const [staffMessages, setStaffMessages] = useState([]);
  const [error, setError] = useState('');
  const [pushStatus, setPushStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [resolving, setResolving] = useState('');
  const [enabled, setEnabled] = useState(Boolean(localStorage.getItem('afubiaPushTokenId')));
  const [popups, setPopups] = useState([]);
  const firstSnapshot = useRef(true);

  useEffect(() => {
    firstSnapshot.current = true;
    return onSnapshot(query(collection(db, 'branchNotifications'), orderBy('createdAt', 'desc'), limit(100)), snapshot => {
      const incoming = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
      if (!firstSnapshot.current) {
        const fresh = snapshot.docChanges().filter(change => change.type === 'added').map(change => ({ id: change.doc.id, ...change.doc.data() }));
        const relevant = fresh.filter(r => branchId === 'all' || r.branchId === branchId);
        if (relevant.length) setPopups(current => [...relevant, ...current].slice(0, 4));
      }
      firstSnapshot.current = false;
      setRecords(incoming); setError('');
    }, () => setError('Live activity could not load. Check your connection and Firestore permissions.'));
  }, [branchId]);

  useEffect(() => onSnapshot(query(collection(db, 'staffMessages'), orderBy('createdAt', 'desc'), limit(50)), snapshot => {
    setStaffMessages(snapshot.docs.map(d => ({ id: d.id, ...d.data() })));
  }, () => setError('Staff messages could not load. Check that the admin account has permission to read staffMessages.')), []);

  useEffect(() => {
    let stop = () => {};
    let cancelled = false;
    (async () => {
      if (!await isSupported() || cancelled) return;
      stop = watchForegroundPush(async payload => {
        if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
        const data = payload?.data || {};
        try {
          const registration = await navigator.serviceWorker.ready;
          await registration.showNotification(data.title || 'Afubia Farms', {
            body: data.body || 'New shop activity', icon: '/app-icon-192.png', badge: '/favicon.svg',
            tag: data.eventId || `afubia-${Date.now()}`, data: { url: data.url || '/admin' },
            vibrate: [200, 100, 200, 100, 350], silent: false,
          });
        } catch (e) { console.warn('Could not show foreground push notification:', e); }
      });
    })().catch(e => console.warn('Foreground push listener is unavailable:', e));
    return () => { cancelled = true; stop(); };
  }, []);

  useEffect(() => {
    if (!popups.length) return undefined;
    const timer = window.setTimeout(() => setPopups(current => current.slice(0, -1)), 7000);
    return () => window.clearTimeout(timer);
  }, [popups]);

  const visible = records.filter(r => branchId === 'all' || r.branchId === branchId).slice(0, 12);
  const visibleMessages = staffMessages.filter(r => branchId === 'all' || r.branchId === branchId);

  async function togglePush() {
    setBusy(true); setPushStatus('');
    try {
      if (enabled) { await disableAdminPush(); setEnabled(false); setPushStatus('Notifications disabled on this device.'); }
      else { await enableAdminPush(); setEnabled(true); setPushStatus('Notifications enabled on this device. Allow browser notifications and check device sound/vibration settings.'); }
    } catch (e) { setPushStatus(e.message || 'Could not configure notifications.'); }
    finally { setBusy(false); }
  }

  async function markRead(id) {
    try { await updateDoc(doc(db, 'branchNotifications', id), { read: true }); }
    catch { setError('Could not mark the notification as read. Please retry.'); }
  }

  async function resolveMessage(id) {
    setResolving(id); setError('');
    try { await updateDoc(doc(db, 'staffMessages', id), { status: 'resolved', resolvedAt: serverTimestamp(), resolvedBy: auth.currentUser?.uid || '' }); }
    catch { setError('Could not mark the staff message as resolved. Check the admin permissions and retry.'); }
    finally { setResolving(''); }
  }

  return <>
    <div className="branch-notification-popups" aria-live="polite" aria-relevant="additions">
      {popups.map(r => <article className="branch-notification-popup" key={r.id}>
        <span className="popup-icon">{r.type === 'sale_recorded' ? '₦' : r.type === 'staff_message' ? '!' : r.type === 'stock_low' ? '⚠' : '↻'}</span>
        <div><strong>{labels[r.type] || 'Shop activity'}</strong><p>{r.staffName || 'Staff member'} · {r.branchName || r.branchId}</p><small>{r.body || r.productName || (r.type === 'sale_recorded' ? money(r.totalAmount) : '')}</small></div>
        <button type="button" aria-label="Dismiss notification" onClick={() => setPopups(current => current.filter(item => item.id !== r.id))}>×</button>
      </article>)}
    </div>
    <section className="branch-notifications">
      <div className="branch-notifications-heading"><div><span className="section-kicker">LIVE BRANCH ACTIVITY</span><h2>Sales, stock, staff messages & attendance</h2><p>Live updates from Ogidan Shop and Kara Shop.</p></div><button type="button" onClick={togglePush} disabled={busy} className="workspace-button">{busy ? 'Please wait…' : enabled ? 'Disable alerts on this device' : 'Enable browser alerts'}</button></div>
      {pushStatus && <p role="status" className="push-status">{pushStatus}</p>}
      {error && <p role="alert" className="branch-notifications-error">{error}</p>}
      {!error && visible.length === 0 && <p className="branch-notifications-empty">No activity recorded for this branch yet.</p>}
      <ul className="branch-notifications-list">{visible.map(r => <li key={r.id} className={r.read ? 'is-read' : 'is-unread'}>
        <span className="branch-notifications-icon" aria-hidden="true">{r.type === 'sale_recorded' ? '₦' : r.type === 'staff_message' ? '!' : r.type === 'stock_low' ? '⚠' : r.type === 'oil_turned' ? '↻' : '↗'}</span>
        <div className="branch-notifications-copy"><strong>{labels[r.type] || 'Shop activity'}{r.productName ? ` · ${r.productName}` : ''}</strong><span>{r.staffName || 'Staff member'} · {r.branchName || r.branchId}</span><small>{r.body || formatWhen(r.createdAt)}</small><small>{formatWhen(r.createdAt)}</small></div>
        <div className="branch-notifications-amount">{r.type === 'sale_recorded' && <strong>{money(r.totalAmount)}</strong>}{!r.read && <button type="button" className="notification-read-button" onClick={() => markRead(r.id)}>Mark read</button>}</div>
      </li>)}</ul>

      <div className="staff-messages-panel">
        <div className="staff-messages-heading"><div><span className="section-kicker">STAFF SUPPORT</span><h2>Messages from salespeople</h2><p>Reports about finished products, low stock, missing kegs and other shop problems.</p></div><span className="staff-message-count">{visibleMessages.filter(m => m.status !== 'resolved').length} open</span></div>
        {!visibleMessages.length ? <p className="branch-notifications-empty">No staff messages yet.</p> : <ul className="staff-messages-list">{visibleMessages.map(m => <li key={m.id} className={m.status === 'resolved' ? 'staff-message-resolved' : ''}>
          <div className="staff-message-main"><div className="staff-message-labels"><strong>{messageLabels[m.category] || 'Staff report'}</strong><span>{m.status === 'resolved' ? 'Resolved' : 'Needs attention'}</span></div><p className="staff-message-meta">{m.staffName || 'Staff member'} · {m.branchName || m.branchId} · {m.productName || 'No product specified'}</p>{m.message && <p className="staff-message-body">{m.message}</p>}<small>{formatWhen(m.createdAt)}</small></div>
          {m.status !== 'resolved' && <button type="button" className="resolve-staff-message" disabled={resolving === m.id} onClick={() => resolveMessage(m.id)}>{resolving === m.id ? 'Saving…' : 'Mark resolved'}</button>}
        </li>)}</ul>}
      </div>
    </section>
  </>;
}

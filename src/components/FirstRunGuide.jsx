import { useEffect, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from '../Firebase/firebase.utils';
import './first-run-guide.css';

const ADMIN_STEPS = [
  { title: 'Welcome to Afubia Farms', body: 'This quick tour shows you where to check both shops, stock, staff messages, attendance and reports.' },
  { title: 'Choose the shop you want to review', body: 'Use the branch filter to switch between Ogidan Shop and Kara Shop. Check the selected branch before reviewing records.' },
  { title: 'Watch staff messages', body: 'Open “Messages from salespeople” in the live activity area. Reports about finished products, low stock or other problems appear here. Open each report and mark it resolved after you act on it.' },
  { title: 'Check sales and oil turning', body: 'New sales and oil-turning records appear in live activity. Low-stock alerts are raised when tracked stock crosses its warning level.' },
  { title: 'Turn on phone and computer alerts', body: 'Choose “Enable browser alerts” on each device. Allow notifications when asked. Keep the website hosted on HTTPS. Your browser and device settings control sound and vibration.' },
  { title: 'Review attendance, stock and reports', body: 'Use the admin dashboard to check attendance, staff location, opening stock, materials, stock balances, reports and profit.' },
];

const STAFF_STEPS = [
  { title: 'Welcome! Make we show you around 👋', body: 'Na here you go dey do your daily work. Use the buttons wey dey dashboard, and make sure say na your correct shop you dey use.' },
  { title: 'Before you sell, check the stock', body: 'Choose the correct product and quantity. If stock no reach, no force the sale enter. The app suppose tell you say stock no reach.' },
  { title: 'If product don finish, tell oga/admin', body: 'For Sales page, find “Report stock issue / message admin”. Choose “Product don finish” or “Stock dey low”, choose the product, add small explanation, then send am. Admin go see the message.' },
  { title: 'How to record sale', body: 'Record only the sale wey really happen. Check product, quantity and price well before you save. No guess quantity or price.' },
  { title: 'How to turn oil', body: 'For “Turn Oil”, enter the number of kegs and containers wey you really use. One keg get 27 litres wey fit use. If keg or empty bottles no dey, message admin—no make up numbers.' },
  { title: 'If anything confuse you', body: 'Tap “Help & demo” any time make you see these instructions again. If app show error or stock no correct, take note of wetin happen and message admin.' },
];

const ADMIN_ROLES = ['admin', 'administrator', 'superadmin', 'super_admin'];
const SALES_ROLES = ['salesgirl', 'salesperson', 'sales_rep'];

export default function FirstRunGuide() {
  const [profile, setProfile] = useState(null);
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [role, setRole] = useState('');

  useEffect(() => onAuthStateChanged(auth, async user => {
    if (!user) { setProfile(null); setOpen(false); setRole(''); return; }
    setOpen(false);
    try {
      const snapshot = await getDoc(doc(db, 'users', user.uid));
      const data = snapshot.exists() ? snapshot.data() : {};
      const actualRole = String(data.role || data.userRole || '').toLowerCase();
      const isAdmin = ADMIN_ROLES.includes(actualRole) || user.email?.toLowerCase() === 'chukwuamakanwachukwu@outlook.com';
      const nextRole = isAdmin ? 'admin' : SALES_ROLES.includes(actualRole) ? 'staff' : '';
      setProfile({ uid: user.uid, displayName: data.displayName || data.fullName || data.name || user.displayName || '' });
      setRole(nextRole);
      if (nextRole) {
        const key = `afubiaGuideSeen:${user.uid}:${nextRole}`;
        if (localStorage.getItem(key) !== 'yes') { setStep(0); setOpen(true); }
      }
    } catch { setProfile({ uid: user.uid, displayName: '' }); }
  }), []);

  if (!profile || !role) return null;
  const steps = role === 'staff' ? STAFF_STEPS : ADMIN_STEPS;
  const finish = () => {
    localStorage.setItem(`afubiaGuideSeen:${profile.uid}:${role}`, 'yes');
    setOpen(false);
    setStep(0);
  };
  const current = steps[step];

  return <>
    <button className="af-guide-reopen" type="button" onClick={() => { setStep(0); setOpen(true); }}>❔ Help & demo</button>
    {open && <div className="af-guide-backdrop" role="presentation">
      <section className="af-guide-dialog" role="dialog" aria-modal="true" aria-labelledby="af-guide-title">
        <div className="af-guide-topline"><span>{role === 'staff' ? 'SALESPERSON QUICK GUIDE' : 'ADMIN QUICK GUIDE'}</span><button type="button" aria-label="Close guide" onClick={finish}>×</button></div>
        <div className="af-guide-progress" aria-label={`Step ${step + 1} of ${steps.length}`}><span style={{ width: `${((step + 1) / steps.length) * 100}%` }} /></div>
        <p className="af-guide-step">STEP {step + 1} OF {steps.length}</p>
        <h2 id="af-guide-title">{current.title}</h2>
        <p className="af-guide-body">{current.body}</p>
        <div className="af-guide-actions">
          <button type="button" className="af-guide-secondary" onClick={finish}>Skip tour</button>
          <div>{step > 0 && <button type="button" className="af-guide-secondary" onClick={() => setStep(value => value - 1)}>Back</button>}
            {step < steps.length - 1 ? <button type="button" className="af-guide-primary" onClick={() => setStep(value => value + 1)}>Next →</button> : <button type="button" className="af-guide-primary" onClick={finish}>Let’s go</button>}</div>
        </div>
      </section>
    </div>}
  </>;
}

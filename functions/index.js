import { initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { balance, assertAvailable, category, number, pack } from './inventory.js';
initializeApp();
const db = getFirestore();
const roles = ['admin', 'administrator', 'superadmin', 'super_admin'];
const collections = ['sales', 'conversions', 'materials', 'shopOpeningStock'];
const branchName = id => id === 'kara' ? 'Kara Shop' : 'Ogidan Shop';

// All clients contend on one per-branch lock. Checks and writes commit together.
// A request UUID makes retrying the same request safe after network failures.
export const recordBusiness = onCall({
  region: 'us-central1',
  // Callable endpoints must answer the browser's preflight request.
  cors: true,
  // The endpoint is publicly reachable, but every write is still checked
  // against Firebase Authentication and the user's Firestore profile below.
  invoker: 'public',
}, async request => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in first.');
  const { kind, record, requestId } = request.data || {};
  if (!collections.includes(kind) || !record || !/^[a-zA-Z0-9-]{10,80}$/.test(requestId || '')) throw new HttpsError('invalid-argument', 'Invalid business request.');
  const uid = request.auth.uid;
  return db.runTransaction(async tx => {
    const profileDoc = await tx.get(db.doc(`users/${uid}`));
    const profile = profileDoc.data();
    if (!profile || profile.active === false) throw new HttpsError('permission-denied', 'Account inactive or missing.');
    const admin = roles.includes(profile.role || profile.userRole);
    if (!admin && !['salesgirl', 'salesperson', 'sales_rep'].includes(profile.role || profile.userRole)) throw new HttpsError('permission-denied', 'Salesperson access required.');
    const rawBranch = String(profile.branchId || profile.branch || profile.branchName || '').toLowerCase().replace(/[_\s]+/g, '-');
    const staffBranch = ['kara', 'kara-shop'].includes(rawBranch) ? 'kara' : ['ogidan', 'ogidan-shop'].includes(rawBranch) ? 'ogidan' : '';
    const branchId = admin ? record.branchId : staffBranch;
    if (!['kara', 'ogidan'].includes(branchId)) throw new HttpsError('failed-precondition', 'Assign a valid shop first.');
    const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Lagos', hour: '2-digit', hourCycle: 'h23' }).format(new Date()));
    if (!admin && (hour < 8 || hour >= 18)) throw new HttpsError('permission-denied', 'Staff working hours are 8am to 6pm Nigeria time.');
    if (!admin && !['sales', 'conversions'].includes(kind)) throw new HttpsError('permission-denied', 'Administrator access required.');
    const receiptRef = db.doc(`businessRequests/${uid}_${requestId}`);
    const receipt = await tx.get(receiptRef);
    if (receipt.exists) return receipt.data();
    const lock = db.doc(`inventoryLocks/${branchId}`);
    await tx.get(lock);
    const records = {};
    for (const name of collections) {
      const snap = await tx.get(db.collection(name).where('branchId', '==', branchId));
      records[name] = snap.docs.map(d => d.data());
    }
    const data = { ...record, branchId, branchName: branchName(branchId), userId: uid, createdBy: uid, recordedByUid: uid,
      userEmail: request.auth.token.email || '', staffName: profile.displayName || profile.name || '',
      userDisplayName: profile.displayName || '', staffId: profile.staffId || '', userRole: profile.role || profile.userRole || 'salesgirl',
      source: admin ? 'admin' : 'salesgirl', createdAt: FieldValue.serverTimestamp(), timestamp: FieldValue.serverTimestamp(), recordedAt: FieldValue.serverTimestamp() };
    let genericOpening = 0;
    if (['sales', 'conversions'].includes(kind)) {
      // Never let a crafted client bypass stock checks or disguise a shop transaction.
      data.affectsStock = true; data.stockLocation = 'shop'; data.saleLocation = 'shop'; data.location = 'shop';
      if (kind === 'sales') {
        data.isShopSale = true;
        if (!data.productId || typeof data.productId !== 'string' || data.productId.includes('/')) throw new HttpsError('invalid-argument', 'Choose a saved product.');
        {
          const product = await tx.get(db.doc(`products/${data.productId}`));
          if (!product.exists || product.data().active === false) throw new HttpsError('failed-precondition', 'Product unavailable.');
          const p = product.data();
          if (p.isActive === false || p.enabled === false) throw new HttpsError('failed-precondition', 'Product unavailable.');
          data.category = category(p); data.productCategory = data.category; data.stockCategory = data.category;
          data.productName = p.productName || p.name || data.productName;
          data.stockContainerType = pack(p) || pack(data);
          data.productVolumeLitres = number(p.sizeLitres ?? p.productVolumeLitres ?? p.bottleSizeLitres ?? p.containerVolumeLitres) || number(data.productVolumeLitres);
          data.unit = p.unit || ''; data.stockUnit = p.unit || '';
          genericOpening = number(p.openingStockByBranch?.[branchId]);
          data.productType = p.productType || p.type || data.category;
        }
        const qty = number(data.quantitySold);
        if (!(qty > 0) || !Number.isFinite(qty)) throw new HttpsError('invalid-argument', 'Invalid quantity.');
        // Derive deductions, do not trust client-supplied litres or honey counts.
        const size = { '75cl': .75, '1L': 1, '5L': 5 }[pack(data)] || number(data.productVolumeLitres);
        if (['Palm Oil', 'Kuli-Kuli Oil'].includes(category(data)) && !(size > 0)) throw new HttpsError('invalid-argument', 'Product volume is required.');
        data.litresSold = ['Honey', 'Other'].includes(category(data)) ? 0 : qty * size;
        data.palmOilLitresSold = category(data) === 'Palm Oil' ? data.litresSold : 0;
        data.kuliKuliLitresSold = category(data) === 'Kuli-Kuli Oil' ? data.litresSold : 0;
        data.honeyBottlesSold = category(data) === 'Honey' ? qty : 0;
        if (!Number.isFinite(Number(data.unitPrice)) || Number(data.unitPrice) < 0) throw new HttpsError('invalid-argument', 'Invalid selling price.');
        data.totalAmount = qty * Number(data.unitPrice); data.total = data.totalAmount; data.amount = data.totalAmount; data.revenue = data.totalAmount;
        Object.assign(data, { quantity: qty, oilLitresSold: data.palmOilLitresSold, kuliKuliOilLitresSold: data.kuliKuliLitresSold,
          quantityLitres: data.litresSold, litersSold: data.litresSold, totalLitres: data.litresSold,
          quantityBottles: data.honeyBottlesSold, bottlesSold: data.honeyBottlesSold, honeyQuantitySold: data.honeyBottlesSold });
      } else {
        data.affectsShopStock = true; data.affectsFarmStock = false;
        data.litresProduced = number(data.kegCount) * 27;
        data.litresUsed = number(data.bottles75cl) * .75 + number(data.bottles1L) + number(data.jerrycans5L) * 5;
        data.litresRemaining = data.litresProduced - data.litresUsed;
        Object.assign(data, { kegs: number(data.kegCount), usableLitresPerKeg: 27, nominalKegCapacityLitres: 30,
          bottles75clProduced: number(data.bottles75cl), bottles1LProduced: number(data.bottles1L), jerrycans5LProduced: number(data.jerrycans5L),
          totalLitres: data.litresProduced, oilProducedLitres: data.litresProduced, oilUsedLitres: data.litresUsed, oilRemainingLitres: data.litresRemaining });
      }
      const available = balance(records);
      if (kind === 'sales' && category(data) === 'Other') available.generic[data.productId] = (available.generic[data.productId] || 0) + genericOpening;
      try { assertAvailable(kind, data, available); }
      catch (e) { throw new HttpsError('failed-precondition', e.message); }
    }
    const ref = db.collection(kind).doc();
    tx.create(ref, data);
    tx.set(lock, { updatedAt: FieldValue.serverTimestamp(), lastRecord: ref.id });
    tx.create(receiptRef, { id: ref.id, kind });
    if (['sales', 'conversions'].includes(kind)) {
      tx.create(db.doc(`branchNotifications/${ref.id}`), {
        type: kind === 'sales' ? 'sale_recorded' : 'oil_turned', userId: uid, branchId, branchName: branchName(branchId),
        staffName: data.staffName, productName: kind === 'sales' ? data.productName : 'Oil turning', quantity: data.quantitySold || data.kegCount,
        totalAmount: data.totalAmount || 0, createdAt: FieldValue.serverTimestamp(), read: false,
        title: kind === 'sales' ? 'New sale recorded' : 'Oil turned',
        body: `${data.staffName || 'Staff member'} · ${branchName(branchId)} · ${kind === 'sales' ? data.productName : data.kegCount + ' keg(s)'}`
      });
    }
    return { id: ref.id, kind };
  });
});

export const attendanceNotification = onDocumentCreated('staffAttendance/{id}', async event => {
  const r = event.data.data();
  await db.doc(`branchNotifications/attendance_${event.params.id}`).set({
    type: r.eventType, userId: r.userId, staffName: r.staffName, branchId: r.branchId, branchName: r.branchName,
    title: r.eventType === 'sign_in' ? 'Staff signed in' : 'Staff signed out',
    body: `${r.staffName || 'Staff member'} · ${r.branchName || r.branchId}`, createdAt: r.timestamp, read: false
  });
});



// Every staff report becomes an admin-only activity item, which in turn
// triggers the existing FCM sender for each verified admin device.
export const staffMessageNotification = onDocumentCreated('staffMessages/{id}', async event => {
  const r = event.data.data();
  const kind = String(r.category || 'other');
  const labels = {
    product_finished: 'Product don finish', low_stock: 'Stock dey low',
    missing_kegs: 'Keg no dey', missing_containers: 'Empty containers no dey', other: 'Staff report',
  };
  const detail = String(r.message || '').trim();
  await db.doc(`branchNotifications/staff_message_${event.params.id}`).set({
    type: 'staff_message', userId: r.userId, staffName: r.staffName || 'Staff member',
    staffId: r.staffId || '', branchId: r.branchId, branchName: r.branchName || branchName(r.branchId),
    productName: r.productName || '', category: kind, message: detail,
    title: labels[kind] || 'New staff message',
    body: `${r.staffName || 'Staff member'} · ${r.branchName || branchName(r.branchId)} · ${r.productName || 'Shop issue'}${detail ? ` · ${detail}` : ''}`,
    createdAt: FieldValue.serverTimestamp(), read: false, sourceMessageId: event.params.id,
  });
});

const stockThresholds = [
  ['stock', 'Palm Oil', 10, 'L'], ['stock', 'Kuli-Kuli Oil', 10, 'L'], ['stock', 'Honey', 10, 'bottles'],
  ['materials', '75cl', 30, 'containers'], ['materials', '1L', 30, 'containers'],
  ['materials', '5L', 30, 'containers'], ['materials', 'kegs', 2, 'kegs'],
];

async function alertWhenStockCrossesThreshold(event, collectionName) {
  const record = event.data?.data();
  const branchId = record?.branchId;
  if (!['kara', 'ogidan'].includes(branchId)) return;
  const names = ['sales', 'conversions', 'materials', 'shopOpeningStock'];
  const snapshots = await Promise.all(names.map(name => db.collection(name).where('branchId', '==', branchId).get()));
  const records = Object.fromEntries(snapshots.map((snapshot, index) => [names[index], snapshot.docs.map(d => ({ id: d.id, ...d.data() }))]));
  const current = balance(records);
  const beforeRecords = { ...records, [collectionName]: records[collectionName].filter(r => r.id !== event.params.id) };
  const previous = balance(beforeRecords);
  const alerts = [];
  for (const [group, key, threshold, unit] of stockThresholds) {
    const now = current[group][key];
    const before = previous[group][key];
    if (before > threshold && now <= threshold) {
      const idKey = `${group}_${key}`.replace(/[^a-zA-Z0-9_-]/g, '_');
      alerts.push(db.doc(`branchNotifications/low_${branchId}_${idKey}_${event.params.id}`).set({
        type: 'stock_low', userId: record.userId || '', branchId, branchName: branchName(branchId),
        productName: key, quantityRemaining: Math.max(0, Math.round(now * 100) / 100),
        title: now <= 0 ? 'Product finished / stock empty' : 'Low stock alert',
        body: `${key} ${now <= 0 ? 'don finish' : 'dey low'} for ${branchName(branchId)} (${Math.max(0, Math.round(now * 100) / 100)} ${unit} remain).`,
        createdAt: FieldValue.serverTimestamp(), read: false, sourceRecordId: event.params.id,
      }));
    }
  }
  await Promise.all(alerts);
}

export const saleStockThresholdNotification = onDocumentCreated('sales/{id}', event => alertWhenStockCrossesThreshold(event, 'sales'));
export const conversionStockThresholdNotification = onDocumentCreated('conversions/{id}', event => alertWhenStockCrossesThreshold(event, 'conversions'));

export const pushNotification = onDocumentCreated('branchNotifications/{id}', async event => {
  const r = event.data.data();
  const devices = await db.collection('adminPushTokens').get();
  // Recheck the owner's role so revoked admins cannot retain push access.
  const valid = [];
  for (const d of devices.docs) {
    const p = (await db.doc(`users/${d.data().userId}`).get()).data();
    if (p && p.active !== false && roles.includes(p.role || p.userRole) && d.data().token) valid.push(d);
  }
  for (let i = 0; i < valid.length; i += 500) {
    const chunk = valid.slice(i, i + 500);
    const response = await getMessaging().sendEachForMulticast({ tokens: chunk.map(d => d.data().token), data: {
      title: r.title || 'Afubia Farms activity', body: r.body || `${r.staffName || 'Staff'} · ${r.branchName || ''}`,
      eventId: event.params.id, url: '/admin', urgent: r.type === 'stock_low' ? 'true' : 'false'
    }, webpush: { headers: { Urgency: r.type === 'stock_low' ? 'high' : 'normal', TTL: '86400' } } });
    await Promise.all(response.responses.map((result, j) => !result.success && ['messaging/registration-token-not-registered', 'messaging/invalid-registration-token'].includes(result.error?.code) ? chunk[j].ref.delete() : Promise.resolve()));
  }
});

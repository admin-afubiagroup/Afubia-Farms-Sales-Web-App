import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { initializeApp as initAdmin, deleteApp as deleteAdmin } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth as adminAuth } from 'firebase-admin/auth';
import { initializeApp, deleteApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword } from 'firebase/auth';
import { getFunctions, connectFunctionsEmulator, httpsCallable } from 'firebase/functions';
import { getFirestore as clientFirestore, connectFirestoreEmulator, addDoc, collection, serverTimestamp } from 'firebase/firestore';
if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST) throw new Error('Run ONLY inside Firebase emulators. Never against a live project.');
let admin, client, db, record;
before(async () => {
  admin = initAdmin({ projectId: 'demo-afubia' }); db = getFirestore(admin);
  // Only the demo emulator is modified. Test data never touches production.
  for (const name of ['sales', 'conversions', 'materials', 'shopOpeningStock', 'businessRequests', 'branchNotifications', 'inventoryLocks', 'adminPushTokens']) {
    const snap = await db.collection(name).get(); await Promise.all(snap.docs.map(d => d.ref.delete()));
  }
  try { await adminAuth(admin).createUser({ uid: 'test-admin', email: 'admin@example.test', password: 'Demo-only-123!' }); } catch (e) { if (e.code !== 'auth/uid-already-exists') throw e; }
  await db.doc('users/test-admin').set({ role: 'admin', active: true, displayName: 'Demo Admin' });
  await db.doc('products/test-1l').set({ category: 'Palm Oil', name: '1L Palm Oil', size: '1L', sizeLitres: 1, unit: 'bottle', price: 3000, active: true });
  client = initializeApp({ apiKey: 'demo-key', projectId: 'demo-afubia', appId: '1:123:web:demo' }, 'integration');
  const auth = getAuth(client); connectAuthEmulator(auth, 'http://127.0.0.1:9098', { disableWarnings: true });
  await signInWithEmailAndPassword(auth, 'admin@example.test', 'Demo-only-123!');
  const functions = getFunctions(client); connectFunctionsEmulator(functions, '127.0.0.1', 5008);
  record = httpsCallable(functions, 'recordBusiness');
});
after(async () => { if (client) await deleteApp(client); if (admin) await deleteAdmin(admin); });
const payload = (kind, data, requestId = crypto.randomUUID()) => ({ kind, requestId, record: { branchId: 'kara', branchName: 'Kara Shop', ...data } });
const sale = { productId: 'test-1l', productName: '1L Palm Oil', category: 'Palm Oil', quantitySold: 1, unitPrice: 3000, productVolumeLitres: 1, stockLocation: 'shop' };

test('callable saves opening stock and returns persisted document id', async () => {
  const result = await record(payload('shopOpeningStock', { category: 'Palm Oil', productName: '1L Palm Oil', quantity: 1, quantityLitres: 1, unit: '1L', status: 'completed' }));
  assert.equal((await db.doc(`shopOpeningStock/${result.data.id}`).get()).exists, true);
});
test('two simultaneous sales of the final bottle: exactly one commits', async () => {
  const outcomes = await Promise.allSettled([record(payload('sales', sale)), record(payload('sales', sale))]);
  assert.equal(outcomes.filter(r => r.status === 'fulfilled').length, 1);
  const snap = await db.collection('sales').get(); assert.equal(snap.size, 1);
  assert.equal((await db.collection('branchNotifications').where('type', '==', 'sale_recorded').get()).size, 1);
});
test('out-of-stock rejection leaves database unchanged', async () => {
  await assert.rejects(record(payload('sales', sale)), /stock no reach/);
  assert.equal((await db.collection('sales').get()).size, 1);
});
test('conversion without purchased materials is rejected', async () => {
  await assert.rejects(record(payload('conversions', { kegCount: 1, bottles75cl: 0, bottles1L: 27, jerrycans5L: 0 })), /Not enough/);
  assert.equal((await db.collection('conversions').get()).size, 0);
});
test('materials save, conversion consumes them, and request retry is idempotent', async () => {
  await record(payload('materials', { inventoryType: 'kegs', materialName: 'Oil kegs', quantity: 1, purchasedQuantity: 1, status: 'Purchased' }));
  await record(payload('materials', { inventoryType: '1L', materialName: '1L empty bottles', quantity: 27, purchasedQuantity: 27, status: 'Purchased' }));
  const request = payload('conversions', { kegCount: 1, bottles75cl: 0, bottles1L: 27, jerrycans5L: 0 });
  const first = await record(request), second = await record(request);
  assert.equal(first.data.id, second.data.id);
  assert.equal((await db.collection('conversions').get()).size, 1);
  await assert.rejects(record(payload('conversions', request.record)), /Not enough/);
});
test('newly turned packages can be sold and canonical totals are saved', async () => {
  const result = await record(payload('sales', { ...sale, totalAmount: 999999, litresSold: .01 }));
  const saved = (await db.doc(`sales/${result.data.id}`).get()).data();
  assert.equal(saved.litresSold, 1); assert.equal(saved.totalAmount, 3000);
});
test('forged stock bypass flags cannot sell more than available', async () => {
  await assert.rejects(record(payload('sales', { ...sale, quantitySold: 100, affectsStock: false, isShopSale: false, stockLocation: 'farm' })), /stock no reach/);
});
test('Other products respect independent shop-specific unit balances', async () => {
  await db.doc('products/test-other').set({ category: 'Other', name: 'Soap', price: 100, unit: 'piece', sizeLitres: 0, openingStockByBranch: { kara: 2, ogidan: 0 }, active: true });
  const r = { productId: 'test-other', productName: 'Soap', category: 'Other', quantitySold: 2, unitPrice: 100 };
  await record(payload('sales', r));
  await assert.rejects(record(payload('sales', { ...r, quantitySold: 1 })), /stock no reach/);
});
test('sign-in and sign-out attendance generate admin notification records', async () => {
  try { await adminAuth(admin).createUser({ uid: 'test-staff', email: 'chukwuamaka.nwachukwu@gmail.com', password: 'Demo-only-123!' }); } catch (e) { if (e.code !== 'auth/uid-already-exists') throw e; }
  await db.doc('users/test-staff').set({ role: 'salesgirl', active: true, branchId: 'kara', branchName: 'Kara Shop', displayName: 'Demo Salesperson', staffId: 'KARA-SALESREP-001' });
  await signInWithEmailAndPassword(getAuth(client), 'chukwuamaka.nwachukwu@gmail.com', 'Demo-only-123!');
  const store = clientFirestore(client); connectFirestoreEmulator(store, '127.0.0.1', 8088);
  for (const eventType of ['sign_in', 'sign_out']) {
    const ref = await addDoc(collection(store, 'staffAttendance'), { userId: 'test-staff', staffId: 'KARA-SALESREP-001', staffName: 'Demo Salesperson', branchId: 'kara', branchName: 'Kara Shop', eventType, timestamp: serverTimestamp() });
    let notification;
    for (let attempt = 0; attempt < 60; attempt++) {
      notification = await db.doc(`branchNotifications/attendance_${ref.id}`).get();
      if (notification.exists) break;
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    assert.equal(notification.exists, true); assert.equal(notification.data().type, eventType);
  }
});

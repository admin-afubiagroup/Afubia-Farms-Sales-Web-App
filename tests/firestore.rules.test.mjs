import test, { before, after } from 'node:test';
import fs from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc, serverTimestamp } from 'firebase/firestore';
let env;
before(async () => {
  env = await initializeTestEnvironment({ projectId: 'demo-afubia', firestore: { host: '127.0.0.1', port: 8088, rules: fs.readFileSync('firestore.rules', 'utf8') } });
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    await setDoc(doc(db, 'users/admin'), { role: 'admin', active: true });
    await setDoc(doc(db, 'users/staff'), {
      role: 'salesgirl',
      branchId: 'kara',
      branchName: 'Kara Shop',
      staffId: 'staff',
      displayName: 'Test',
      active: true
    });
    await setDoc(doc(db, 'users/other'), {
      role: 'salesgirl',
      branchId: 'ogidan',
      branchName: 'Ogidan Shop',
      staffId: 'other',
      displayName: 'Other',
      active: true
    });
    await setDoc(doc(db, 'users/inactive'), { role: 'admin', active: false });
    await setDoc(doc(db, 'sales/existing'), { branchId: 'kara', userId: 'staff' });
    await setDoc(doc(db, 'branchNotifications/n1'), { branchId: 'kara' });
  });
});
after(async () => { await env?.cleanup(); });
const user = uid => env.authenticatedContext(uid).firestore();
test('anonymous user cannot read sales', () => assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), 'sales/existing'))));
test('staff can read own branch sales', () => assertSucceeds(getDoc(doc(user('staff'), 'sales/existing'))));
test('staff cannot read another branch', () => assertFails(getDoc(doc(user('other'), 'sales/existing'))));
test('administrator can read branch records', () => assertSucceeds(getDoc(doc(user('admin'), 'sales/existing'))));
test('inactive administrator cannot read sales', () => assertFails(getDoc(doc(user('inactive'), 'sales/existing'))));
test('direct sale writes require complete validated identity and server timestamps', () => assertFails(setDoc(doc(user('staff'), 'sales/forged'), { userId: 'staff', branchId: 'kara' })));
test('administrator sale writes require complete validated identity and server timestamps', () => assertFails(setDoc(doc(user('admin'), 'sales/forged'), { userId: 'admin', branchId: 'kara' })));
test('administrator can directly create a properly stamped sale', () => assertSucceeds(setDoc(doc(user('admin'), 'sales/valid-direct-sale'), {
  userId: 'admin', createdBy: 'admin', recordedByUid: 'admin',
  branchId: 'kara', branchName: 'Kara Shop',
  createdAt: serverTimestamp(), recordedAt: serverTimestamp(), timestamp: serverTimestamp(),
  status: 'completed', quantitySold: 1,
})));
test('oil turning writes require complete validated identity and server timestamps', () => assertFails(setDoc(doc(user('staff'), 'conversions/forged'), { userId: 'staff', branchId: 'kara' })));
test('administrator can directly create a properly stamped oil-turning record', () => assertSucceeds(setDoc(doc(user('admin'), 'conversions/valid-direct-conversion'), {
  userId: 'admin', createdBy: 'admin', recordedByUid: 'admin',
  branchId: 'kara', branchName: 'Kara Shop',
  createdAt: serverTimestamp(), recordedAt: serverTimestamp(), timestamp: serverTimestamp(),
  status: 'completed', kegCount: 1,
})));
test('staff cannot forge purchased materials', () => assertFails(setDoc(doc(user('staff'), 'materials/forged'), { userId: 'staff', branchId: 'kara' })));
test('staff cannot read admin notifications', () => assertFails(getDoc(doc(user('staff'), 'branchNotifications/n1'))));
test('staff cannot grant themselves administrator role', () => assertFails(setDoc(doc(user('staff'), 'users/staff'), { role: 'admin' }, { merge: true })));
test('staff can record timestamped attendance', () => assertSucceeds(setDoc(doc(user('staff'), 'staffAttendance/signin'), { userId: 'staff', staffId: 'staff', staffName: 'Test', branchId: 'kara', branchName: 'Kara Shop', eventType: 'sign_in', timestamp: serverTimestamp() })));
test('staff cannot forge attendance for another branch', () => assertFails(setDoc(doc(user('staff'), 'staffAttendance/forged'), { userId: 'staff', staffId: 'staff', staffName: 'Test', branchId: 'ogidan', branchName: 'Ogidan Shop', eventType: 'sign_in', timestamp: serverTimestamp() })));
test('staff cannot forge another staff ID', () => assertFails(setDoc(doc(user('staff'), 'staffAttendance/forged-staff'), { userId: 'staff', staffId: 'other', staffName: 'Test', branchId: 'kara', branchName: 'Kara Shop', eventType: 'sign_in', timestamp: serverTimestamp() })));
test('staff cannot forge another branch name', () => assertFails(setDoc(doc(user('staff'), 'staffAttendance/forged-branch-name'), { userId: 'staff', staffId: 'staff', staffName: 'Test', branchId: 'kara', branchName: 'Ogidan Shop', eventType: 'sign_in', timestamp: serverTimestamp() })));
test('administrator can register their browser for push', () => assertSucceeds(setDoc(doc(user('admin'), 'adminPushTokens/test'), { userId: 'admin', token: 'test-token', updatedAt: serverTimestamp() })));
test('salesperson cannot register for admin push', () => assertFails(setDoc(doc(user('staff'), 'adminPushTokens/staff'), { userId: 'staff', token: 'test-token', updatedAt: serverTimestamp() })));

test('salesperson can send a message to admin for their own shop', () => assertSucceeds(setDoc(doc(user('staff'), 'staffMessages/own-shop'), {
  userId: 'staff', staffId: 'staff', staffName: 'Test', userRole: 'salesgirl',
  branchId: 'kara', branchName: 'Kara Shop', category: 'product_finished',
  productName: 'Palm Oil', message: 'Palm Oil don finish', status: 'open', createdAt: serverTimestamp(),
})));
test('salesperson cannot send a message for another shop', () => assertFails(setDoc(doc(user('staff'), 'staffMessages/forged-shop'), {
  userId: 'staff', staffId: 'staff', staffName: 'Test', userRole: 'salesgirl',
  branchId: 'ogidan', branchName: 'Ogidan Shop', category: 'product_finished',
  productName: 'Palm Oil', message: 'Stock don finish', status: 'open', createdAt: serverTimestamp(),
})));
test('salesperson cannot read staff messages', () => assertFails(getDoc(doc(user('staff'), 'staffMessages/own-shop'))));
test('administrator can read staff messages', () => assertSucceeds(getDoc(doc(user('admin'), 'staffMessages/own-shop'))));

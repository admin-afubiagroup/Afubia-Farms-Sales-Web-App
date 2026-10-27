import { getMessaging, getToken, isSupported, onMessage, deleteToken } from 'firebase/messaging';
import { doc, setDoc, serverTimestamp, deleteDoc, getDoc } from 'firebase/firestore';
import { app, db, auth } from './firebase.utils';

export async function enableAdminPush() {
  if (!await isSupported()) throw new Error('Push is not supported here. Try a supported browser over HTTPS. On iPhone/iPad, install this app on your Home Screen first.');
  if (!import.meta.env.VITE_FIREBASE_VAPID_KEY) throw new Error('Background notifications need your Firebase Web Push VAPID key. See the deployment guide.');
  if (!auth.currentUser) throw new Error('Sign in first.');
  const profileSnapshot = await getDoc(doc(db, 'users', auth.currentUser.uid));
  const profile = profileSnapshot.exists() ? profileSnapshot.data() : {};
  const role = String(profile.role || profile.userRole || '').toLowerCase();
  const adminRoles = ['admin', 'administrator', 'superadmin', 'super_admin'];
  if (profile.active === false || !adminRoles.includes(role)) throw new Error('Only an active administrator can enable admin notifications.');
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Notifications are blocked. Allow notifications in this site’s browser settings.');
  const registration = await navigator.serviceWorker.register('/firebase-messaging-sw.js', { type: 'module' });
  await navigator.serviceWorker.ready;
  const token = await getToken(getMessaging(app), { vapidKey: import.meta.env.VITE_FIREBASE_VAPID_KEY, serviceWorkerRegistration: registration });
  if (!token) throw new Error('No device token was returned. Try again.');
  const id = (await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)));
  const tokenId = Array.from(new Uint8Array(id), n => n.toString(16).padStart(2, '0')).join('');
  await setDoc(doc(db, 'adminPushTokens', tokenId), { token, userId: auth.currentUser.uid, updatedAt: serverTimestamp() });
  localStorage.setItem('afubiaPushTokenId', tokenId);
  return tokenId;
}
export function watchForegroundPush(callback) { return onMessage(getMessaging(app), callback); }
export async function disableAdminPush() {
  const id = localStorage.getItem('afubiaPushTokenId');
  if (id) await deleteDoc(doc(db, 'adminPushTokens', id));
  if (await isSupported()) await deleteToken(getMessaging(app));
  localStorage.removeItem('afubiaPushTokenId');
}

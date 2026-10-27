import { getFunctions, httpsCallable, connectFunctionsEmulator } from 'firebase/functions';
import { app } from './firebase.utils';

const functions = getFunctions(app, 'us-central1');
if (import.meta.env.VITE_USE_FIREBASE_EMULATORS === 'true') connectFunctionsEmulator(functions, '127.0.0.1', 5008);
const recordBusiness = httpsCallable(functions, 'recordBusiness');
function clean(value) {
  if (Array.isArray(value)) return value.map(clean);
  if (value && typeof value === 'object') {
    // Timestamps are assigned by the trusted backend, never serialized as transforms.
    return Object.fromEntries(Object.entries(value).filter(([key, v]) => v !== undefined && !['createdAt', 'recordedAt', 'timestamp'].includes(key)).map(([k, v]) => [k, clean(v)]));
  }
  return value;
}
export async function saveSecureRecord(kind, record) {
  const requestId = crypto.randomUUID();
  const payload = { kind, record: clean(record), requestId };
  try {
    const result = await recordBusiness(payload);
    return result.data;
  } catch (error) {
    // Retry an uncertain network result once with the SAME idempotency key.
    if (['functions/unavailable', 'functions/deadline-exceeded'].includes(error.code)) {
      const result = await recordBusiness(payload);
      return result.data;
    }
    throw error;
  }
}

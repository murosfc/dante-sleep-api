import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

export const USER_ID = 'ldQOH6q8IYVPWdsazhg8Q0g8nYy2';

function getApp() {
  if (getApps().length) return getApps()[0];

  const projectId = (process.env.FIREBASE_PROJECT_ID ?? 'dante-sleep').trim();
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL?.trim().replace(/^"/, '').replace(/"$/, '');
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.trim()
    .replace(/^"/, '')
    .replace(/"$/, '')
    .replace(/\\n/g, '\n');

  console.log('[Firebase Init] Project ID:', projectId);
  console.log('[Firebase Init] Client Email:', clientEmail ? `${clientEmail.substring(0, 10)}...` : 'undefined');
  console.log('[Firebase Init] Private Key exists:', !!privateKey);
  if (privateKey) {
    console.log('[Firebase Init] Private Key Length:', privateKey.length);
    console.log('[Firebase Init] Private Key starts with BEGIN:', privateKey.startsWith('-----BEGIN PRIVATE KEY-----'));
    console.log('[Firebase Init] Private Key ends with END:', privateKey.trim().endsWith('-----END PRIVATE KEY-----'));
    console.log('[Firebase Init] Private Key contains newlines:', privateKey.includes('\n'));
  }

  return initializeApp({
    credential: cert({
      projectId,
      clientEmail,
      privateKey,
    }),
  });
}

export function getDb() {
  return getFirestore(getApp());
}

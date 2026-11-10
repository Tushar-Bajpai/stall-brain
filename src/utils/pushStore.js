// Web Push client helpers — Phase 3 (§Phase 3 of IMPLEMENTATION_PLAN.md).
//
// Free-plan flow (no Cloud Functions, no Blaze — user decision 2026-11-10):
//   1. The vendor enables alerts on the Mandi page (asked only after the first
//      post / board visit, never on app load — §Permission UX).
//   2. `firebase/messaging getToken()` (needs VITE_FIREBASE_VAPID_KEY, the
//      public half of the Web Push certificate from the Firebase console)
//      stores the FCM token in `fcmTokens/{autoId}`:
//        { userId, token, platform: 'web', createdAt }
//      Doc id is deterministic (`uid__token`) so re-registering never
//      duplicates and the token query needs no composite index.
//   3. After a successful post create, `notifyPushOnPost()` calls the Vercel
//      function `api/push-on-post.js` with the vendor's Firebase ID token;
//      the function finds matching neighbors and sends via FCM HTTP v1.
//      Fire-and-forget: a failure or offline moment changes nothing in the UI.
//
// iOS note (§Phase 3): Safari only shows Web Push in installed-PWA state —
// handled as a Phase-5 enhancement; the UI surfaces an install hint instead.

import { getMessaging, getToken } from 'firebase/messaging'
import { auth, db } from './firebase'
import {
  collection,
  doc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  where,
  writeBatch,
} from 'firebase/firestore'
import { CURRENT_MARKET_SLUG } from '../data/markets'

const PUSH_URL = import.meta.env.VITE_PUSH_URL ?? '/api/push-on-post'

/** Sync, side-effect-free permission read for render-time UI branches. */
export function notificationPermission() {
  if (typeof Notification === 'undefined' || !('serviceWorker' in navigator)) {
    return 'unsupported'
  }
  return Notification.permission // 'granted' | 'denied' | 'default'
}

/** Asks the browser (call from a user gesture only). Returns the final state. */
export async function requestNotificationPermission() {
  if (typeof Notification === 'undefined') return 'unsupported'
  const result = await Notification.requestPermission()
  if (result === 'default') return 'denied' // dismissal blocks the flow; treat like non-granted
  return result
}

function vapidKey() {
  const key = import.meta.env.VITE_FIREBASE_VAPID_KEY
  if (!key || key === 'your_vapid_public_key_here') {
    throw new Error('MISSING_VAPID_KEY')
  }
  return key
}

function swRegistrationUrl() {
  // Config rides on the query: the service worker reads it at activation
  // (public/firebase-messaging-sw.js). All values are public web identifiers.
  const params = new URLSearchParams({
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: import.meta.env.VITE_FIREBASE_APP_ID,
  })
  return `/firebase-messaging-sw.js?${params.toString()}`
}

async function findOrCreateMessagingRegistration() {
  const existing = await navigator.serviceWorker.getRegistrations()
  const messaging = existing.find((registration) =>
    (registration.active?.scriptURL ?? registration.installing?.scriptURL ?? '').includes(
      'firebase-messaging-sw.js',
    ),
  )
  if (messaging) return messaging
  return navigator.serviceWorker.register(swRegistrationUrl())
}

/** Registers (or refreshes) the FCM token for the signed-in vendor. Returns the token or null. */
export async function ensurePushRegistered() {
  const uid = auth?.currentUser?.uid
  if (!uid) return null

  const registration = await findOrCreateMessagingRegistration()
  const messaging = getMessaging()
  const token = await getToken(messaging, {
    vapidKey: vapidKey(),
    serviceWorkerRegistration: registration,
  })
  if (!token) return null

  // Deterministic doc id: re-issuing the same token never creates duplicates;
  // the server push function finds tokens by the userId single-field index.
  await setDoc(
    doc(db, 'fcmTokens', `${uid}__${token}`),
    {
      userId: uid,
      token,
      platform: 'web',
      marketSlug: CURRENT_MARKET_SLUG,
      createdAt: serverTimestamp(),
    },
    { merge: true },
  )
  return token
}

/** Unsubscribes this browser and removes the vendor's stored token docs. */
export async function disablePush() {
  const uid = auth?.currentUser?.uid
  try {
    const messaging = getMessaging()
    await messaging.deleteToken?.()
  } catch {
    // token may already be gone — clearing Firestore docs below is enough.
  }
  if (!uid) return
  const snapshot = await getDocs(
    query(collection(db, 'fcmTokens'), where('userId', '==', uid)),
  )
  if (snapshot.empty) return
  const batch = writeBatch(db)
  snapshot.docs.forEach((docSnap) => batch.delete(docSnap.ref))
  await batch.commit()
}

/**
 * Fire-and-forget alert trigger called after a successful `upsertOwnPost`.
 * Never throws — push is strictly best-effort (rural connections, closed
 * tabs, 4xx from the function must not touch the posting UX).
 */
export async function notifyPushOnPost(postSummary) {
  try {
    const uid = auth?.currentUser
    if (!uid) return
    const idToken = await uid.getIdToken()
    await fetch(PUSH_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({ marketSlug: CURRENT_MARKET_SLUG, ...postSummary }),
    })
  } catch {
    // deliberately silent
  }
}

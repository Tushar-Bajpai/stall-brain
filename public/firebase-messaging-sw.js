// FCM background service worker — Phase 3 (Web Push, free plan).
//
// Served statically from public/ (Vite copies it to /firebase-messaging-sw.js).
// The Firebase web config is passed in the SCRIPT URL's query string at
// registration time (src/utils/pushStore.js) so this file stays generic and no
// config is hardcoded/baked into the repo — the config is an identifier, not a
// secret (see IMPLEMENTATION_PLAN.md §0).
//
// Backend: data-only webpush messages sent by api/push-on-post.js (Vercel,
// free plan) — the message carries { title, body, url } in `data`, and this
// worker composes + displays the notification while the app is closed/backgrounded.
importScripts('https://www.gstatic.com/firebasejs/12.14.0/firebase-app-compat.js')
importScripts('https://www.gstatic.com/firebasejs/12.14.0/firebase-messaging-compat.js')

// The query survives into the SW's own location; also fall back to reading it
// off the registered script URL for robustness.
function readScriptParams() {
  const fromLocation = new URLSearchParams(self.location.search ?? '')
  if (fromLocation.get('apiKey')) return fromLocation
  try {
    const scriptUrl = new URL(
      (self.registration?.active ?? self.registration?.installing ?? self.registration?.waiting)
        ?.scriptURL ?? '',
    )
    return new URLSearchParams(scriptUrl.search)
  } catch {
    return new URLSearchParams()
  }
}

const params = readScriptParams()
const firebaseConfig = {
  apiKey: params.get('apiKey'),
  authDomain: params.get('authDomain'),
  projectId: params.get('projectId'),
  storageBucket: params.get('storageBucket'),
  messagingSenderId: params.get('messagingSenderId'),
  appId: params.get('appId'),
}

if (!firebaseConfig.apiKey || !firebaseConfig.projectId || !firebaseConfig.appId) {
  // Without config this worker can't decrypt FCM pushes — the app page logs
  // instructions when registration with params fails or is retried.
  console.error(
    'firebase-messaging-sw.js registered without Firebase config params. ' +
      'Re-enable alerts on the Mandi page so registration includes the config query.',
  )
} else {
  firebase.initializeApp(firebaseConfig)

  const messaging = firebase.messaging()

  messaging.onBackgroundMessage((payload) => {
    const data = payload?.data ?? {}
    const title =
      typeof data.title === 'string' && data.title
        ? data.title
        : 'Bazaar Brain · मंडी'
    const body = typeof data.body === 'string' ? data.body : ''
    const url =
      typeof data.url === 'string' && data.url ? data.url : '/market'

    self.registration.showNotification(title, {
      body,
      // Deep link target, handled in `notificationclick` below.
      data: { url },
      // One live alert per topic: a new matching post replaces stale ones.
      tag: typeof data.tag === 'string' && data.tag ? data.tag : 'bazaar-market',
    })
  })
}

// Notification click: focus an open app window if any, else open the board.
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = event.notification?.data?.url ?? '/market'

  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        for (const client of clientList) {
          if ('focus' in client) {
            client.navigate?.(target).catch(() => {})
            return client.focus()
          }
        }
        return self.clients.openWindow(target)
      }),
  )
})

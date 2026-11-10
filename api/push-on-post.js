// Vercel serverless function: `push-on-post` (Phase 3, free plan).
//
// Spark has no Firestore-trigger Cloud Functions (Blaze-only), so after a
// successful post create the CLIENT calls this function with its Firebase ID
// token (see src/utils/pushStore.js → notifyPushOnPost). Documented trade-off:
// a poster closing the tab mid-action skips that one alert; upgrade path is a
// real `onDocumentCreated` trigger if Blaze is ever adopted.
//
// Flow: request → verify ID token (Identity Toolkit) → find vendors in the
// same market holding an OPEN post of the OPPOSITE kind with the SAME itemKey
// → send data-only webpush via FCM HTTP v1 → prune dead tokens from Firestore.
//
// Vercel env vars to configure (Project → Settings → Environment Variables):
//   FIREBASE_SERVICE_ACCOUNT_JSON — the FULL service-account JSON
//     (Firebase console → Project settings → Service accounts → "Generate new
//     private key"); paste the whole JSON as the value. NEVER committed.
//   FIREBASE_API_KEY — same web API key as VITE_FIREBASE_API_KEY (ID-token
//     verification, identical to api/forecast.js).
//
// Client env: VITE_PUSH_URL defaults to /api/push-on-post.
//
// Auth + Firestore + FCM here all use raw REST: the Admin SDK's Firestore and
// messaging resources cost nothing, but REST keeps the function dependency-free
// and equally free. The service account is PROJECT-ADMIN level: nothing in this
// file ever trusts request-supplied recipient fields beyond the sender's own
// post summary — recipients are recomputed server-side from Firestore.

import crypto from 'node:crypto'

const IDP_LOOKUP_URL = 'https://identitytoolkit.googleapis.com/v1/accounts:lookup'
const FIRESTORE_BASE = 'https://firestore.googleapis.com/v1'
const FCM_SEND_URL = 'https://fcm.googleapis.com/v1/projects'

// Bounded fan-out on the free tier.
const MAX_MATCHING_POSTS = 30
const MAX_RECIPIENTS = 40
const IN_CHUNK = 10 // Firestore `in` filters accept max 10 (we stay conservative)

// ---------------------------------------------------------------------------
// Service-account JWT → Google access token (cached until expiry)
// ---------------------------------------------------------------------------

let cachedToken = { token: null, expiresAt: 0 }

function b64url(input) {
  return Buffer.from(input, 'utf8').toString('base64url')
}

async function getAccessToken(serviceAccount) {
  const now = Math.floor(Date.now() / 1000)
  if (cachedToken.token && now < cachedToken.expiresAt - 60) {
    return cachedToken.token
  }

  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const claims = b64url(
    JSON.stringify({
      iss: serviceAccount.client_email,
      scope: 'https://www.googleapis.com/auth/firebase.messaging',
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
    }),
  )
  const unsigned = `${header}.${claims}`
  const signature = crypto
    .createSign('RSA-SHA256')
    .update(unsigned)
    .sign(serviceAccount.private_key.replace(/\\n/g, '\n'), 'base64url')
  const assertion = `${unsigned}.${signature}`

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  })
  if (!response.ok) {
    throw new Error('service-account token exchange failed')
  }
  const data = await response.json()
  cachedToken = {
    token: data.access_token,
    expiresAt: now + (Number(data.expires_in) || 3600),
  }
  return cachedToken.token
}

// ---------------------------------------------------------------------------
// Caller identity (same pattern as api/forecast.js)
// ---------------------------------------------------------------------------

async function verifyIdToken(request, webApiKey) {
  const authHeader = request.headers?.authorization ?? ''
  if (!authHeader.startsWith('Bearer ')) return null
  const idToken = authHeader.slice('Bearer '.length)
  if (!idToken) return null
  try {
    const response = await fetch(
      `${IDP_LOOKUP_URL}?key=${webApiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken }),
      },
    )
    if (!response.ok) return null
    const data = await response.json()
    return data?.users?.[0]?.localId ?? null
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Firestore REST helpers
// ---------------------------------------------------------------------------

function valueFilter(fieldPath, op, value) {
  return {
    fieldFilter: {
      field: { fieldPath },
      op,
      value,
    },
  }
}

async function runQuery(projectId, accessToken, structuredQuery) {
  const response = await fetch(
    `${FIRESTORE_BASE}/projects/${projectId}/databases/(default)/documents:runQuery`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ structuredQuery }),
    },
  )
  if (!response.ok) {
    throw new Error(`Firestore runQuery failed (${response.status})`)
  }
  const rows = await response.json()
  return rows
    .filter((row) => row?.document)
    .map((row) => ({ name: row.document.name, fields: row.document.fields ?? {} }))
}

function firstString(fields, key) {
  return typeof fields?.[key]?.stringValue === 'string' ? fields[key].stringValue : null
}

// ---------------------------------------------------------------------------
// FCM send
// ---------------------------------------------------------------------------

function alertCopy(post) {
  const label = post.itemLabel ?? post.itemKey ?? 'item'
  const amount =
    post.qty > 0 && post.unit ? ` (${post.qty} ${post.unit})` : ''
  if (post.kind === 'want') {
    // Recipients hold an OFFER of this item: a neighbor needs their stock.
    return {
      title: 'आपका सामान किसी को चाहिए · A neighbor needs your stock',
      body: `${label}${amount} की माँग लगी है — मंडी बोर्ड में देखें। · Someone needs ${label} — open the Mandi board.`,
      tag: `need-${post.itemKey}`,
    }
  }
  // Recipients hold a WANT: a neighbor posted spare stock.
  return {
    title: 'फ़ालतू माल मिला · A neighbor has spare stock',
    body: `${label}${amount} फ़ालतू है — मंडी बोर्ड में देखें। · Spare ${label} posted — open the Mandi board.`,
    tag: `spare-${post.itemKey}`,
  }
}

async function sendWebPush(projectId, accessToken, token, post, origin) {
  const copy = alertCopy(post)
  const link = `${origin}/market`
  const response = await fetch(`${FCM_SEND_URL}/${projectId}/messages:send`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message: {
        token,
        webpush: {
          // Data-only: the service worker composes + shows the notification
          // (public/firebase-messaging-sw.js). No `notification` field here —
          // that would double-display in Chrome.
          data: {
            title: copy.title,
            body: copy.body,
            url: link,
            tag: copy.tag,
          },
          fcmOptions: { link },
        },
      },
    }),
  })
  if (response.ok) return { token, removed: false }
  const text = await response.text()
  // Prune dead tokens so the next alert doesn't retry them.
  const unregistered =
    response.status === 401 ||
    response.status === 404 ||
    text.includes('UNREGISTERED') ||
    text.includes('registration-token-not-registered') ||
    text.includes('invalid-registration-token')
  return { token, removed: unregistered }
}

// ---------------------------------------------------------------------------

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const webApiKey = process.env.FIREBASE_API_KEY
  if (!webApiKey) {
    res.status(500).json({ error: 'FIREBASE_API_KEY is not configured on the server' })
    return
  }
  const uid = await verifyIdToken(req, webApiKey)
  if (!uid) {
    res.status(401).json({ error: 'unauthenticated' })
    return
  }

  let serviceAccount
  try {
    serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON ?? '')
  } catch {
    serviceAccount = null
  }
  if (!serviceAccount?.client_email || !serviceAccount?.private_key) {
    res.status(500).json({ error: 'FIREBASE_SERVICE_ACCOUNT_JSON is not configured on the server' })
    return
  }
  const projectId = serviceAccount.project_id ?? process.env.FIREBASE_PROJECT_ID
  if (!projectId) {
    res.status(500).json({ error: 'Project id could not be determined' })
    return
  }

  const post = req.body ?? {}
  const itemKey = typeof post.itemKey === 'string' ? post.itemKey.trim() : ''
  const kind = post.kind
  const marketSlug = typeof post.marketSlug === 'string' ? post.marketSlug : ''
  if (!itemKey || (kind !== 'offer' && kind !== 'want') || !marketSlug) {
    res.status(400).json({ error: 'Invalid post payload' })
    return
  }

  let accessToken
  try {
    accessToken = await getAccessToken(serviceAccount)
  } catch {
    res.status(502).json({ error: ' could not authenticate the push sender' })
    return
  }

  const oppositeKind = kind === 'want' ? 'offer' : 'want'

  try {
    // 1. Open matching posts in the same market (deterministic item match).
    const matchingPosts = await runQuery(projectId, accessToken, {
      from: [{ collectionId: 'posts' }],
      where: {
        compositeFilter: {
          op: 'AND',
          filters: [
            valueFilter('marketSlug', 'EQUAL', { stringValue: marketSlug }),
            valueFilter('kind', 'EQUAL', { stringValue: oppositeKind }),
            valueFilter('itemKey', 'EQUAL', { stringValue: itemKey }),
            valueFilter('status', 'EQUAL', { stringValue: 'open' }),
            valueFilter('expiresAt', 'GREATER_THAN', {
              timestampValue: new Date().toISOString(),
            }),
          ],
        },
      },
      limit: MAX_MATCHING_POSTS,
    })

    const ownerIds = [
      ...new Set(
        matchingPosts
          .map((entry) => entry.name?.split('/')[5])
          .filter(Boolean)
          .filter((ownerId) => ownerId !== uid) // never alert the poster
          .slice(0, MAX_RECIPIENTS),
      ),
    ]
    if (ownerIds.length === 0) {
      res.status(200).json({ sent: 0, matchedPosts: matchingPosts.length, recipients: 0 })
      return
    }

    // 2. Their FCM tokens (`in` in chunks of ten; server account bypass rules).
    const tokenDocs = []
    for (let i = 0; i < ownerIds.length; i += IN_CHUNK) {
      const chunk = ownerIds.slice(i, i + IN_CHUNK)
      const docs = await runQuery(projectId, accessToken, {
        from: [{ collectionId: 'fcmTokens' }],
        where: {
          compositeFilter: {
            op: 'AND',
            filters: [
              valueFilter('userId', 'IN', {
                arrayValue: { values: chunk.map((id) => ({ stringValue: id })) },
              }),
              valueFilter('platform', 'EQUAL', { stringValue: 'web' }),
            ],
          },
        },
        limit: MAX_RECIPIENTS,
      })
      tokenDocs.push(...docs)
    }

    // 3. Send, prune unregistered tokens.
    const origin =
      typeof req.headers?.origin === 'string' && req.headers.origin
        ? req.headers.origin
        : `https://${req.headers?.host ?? 'localhost'}`
    const perToken = await Promise.allSettled(
      tokenDocs.map(async (tokenDoc) => {
        let token
        try {
          // token docs store the raw token also under `fields.token`; doc id
          // (`uid__token`) is a fallback so bases stay consistent.
          token = firstString(tokenDoc.fields, 'token') ?? tokenDoc.name.split('__')[1]
        } catch {
          token = null
        }
        if (!token) return { token: null, removed: false }
        return sendWebPush(projectId, accessToken, token, post, origin)
      }),
    )
    const results = perToken.map((entry) => (entry.status === 'fulfilled' ? entry.value : null))
    const sent = results.filter((entry) => entry && !entry.removed).length
    const removed = results.filter((entry) => entry?.removed)
    for (const tokenDoc of tokenDocs.filter((d) => removed.some((r) => r.token === (firstString(d.fields, 'token') ?? d.name.split('__')[1])))) {
      await fetch(`${FIRESTORE_BASE}/${tokenDoc.name}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${accessToken}` },
      }).catch(() => {})
    }

    res.status(200).json({
      sent,
      matchedPosts: matchingPosts.length,
      recipients: tokenDocs.length,
      pruned: removed.length,
    })
  } catch {
    res.status(502).json({ error: 'Could not send notifications' })
  }
}

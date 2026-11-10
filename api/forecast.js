// Vercel serverless function: `forecast` proxy (FIX-2, free-plan build).
//
// Why Vercel and not Firebase: Cloud Functions require the Blaze (pay) plan;
// Vercel's Hobby tier includes serverless functions and this app already
// deploys to Vercel. Result: the Groq key never ships in the browser bundle
// while keeping total monthly cost at ₹0.
//
// Flow: browser → (Bearer Firebase ID token) → this function → Groq.
// The ID token is verified against Google's free Identity Toolkit endpoint;
// no paid product and no heavy admin SDK needed.
//
// Vercel env vars to configure (Project → Settings → Environment Variables):
//   GROQ_API_KEY        — the Groq secret (starts with gsk_)
//   FIREBASE_API_KEY    — the SAME web API key as VITE_FIREBASE_API_KEY
//                         (it is an identifier, not a secret — used server-side
//                          here to verify the caller's ID token)
//   GROQ_MODELS         — optional: comma-separated allowlist; default below
//
// Client use: set VITE_FORECAST_URL=/api/forecast in the deployed env.

const GROQ_ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions'

// Model allowlist: prevents callers from burning arbitrary or expensive models.
const DEFAULT_MODELS = 'openai/gpt-oss-120b,qwen/qwen3.8-27b'
const MAX_TOKENS_LIMIT = 2000

// Best-effort per-instance rate limit (~20 forecasts/day per user). Visibility
// is bounded to this serverless instance's warm lifetime — cheap burst guard,
// not a promise. Firestore-backed counting would burn free-tier quota for it.
const rateBucket = new Map() // uid -> { windowStart, count }
const RATE_LIMIT = 20
const RATE_WINDOW_MS = 24 * 60 * 60 * 1000

async function verifyIdToken(request) {
  const webApiKey = process.env.FIREBASE_API_KEY
  if (!webApiKey) return null

  const authHeader = request.headers?.authorization ?? ''
  if (!authHeader.startsWith('Bearer ')) return null
  const idToken = authHeader.slice('Bearer '.length)
  if (!idToken) return null

  try {
    const response = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${webApiKey}`,
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

function isRateLimited(uid) {
  const now = Date.now()
  const bucket = rateBucket.get(uid)
  if (!bucket || now - bucket.windowStart > RATE_WINDOW_MS) {
    rateBucket.set(uid, { windowStart: now, count: 1 })
    return false
  }
  bucket.count += 1
  return bucket.count > RATE_LIMIT
}

function sanitizeBody(body) {
  const allowedModels = (process.env.GROQ_MODELS ?? DEFAULT_MODELS)
    .split(',')
    .map((m) => m.trim())
    .filter(Boolean)

  const model = typeof body?.model === 'string' ? body.model : ''
  if (!allowedModels.includes(model)) return null

  const messages = Array.isArray(body?.messages) ? body.messages : []
  if (!messages.length) return null

  const maxTokens = Number(body?.max_tokens)
  return {
    model,
    messages: messages.map((message) => ({
      role: message?.role,
      content: typeof message?.content === 'string' ? message.content : '',
    })),
    temperature: Number.isFinite(Number(body?.temperature))
      ? Number(body.temperature)
      : 0.2,
    max_tokens: Number.isFinite(maxTokens)
      ? Math.min(Math.max(1, Math.round(maxTokens)), MAX_TOKENS_LIMIT)
      : MAX_TOKENS_LIMIT,
    ...(model.includes('gpt-oss') ? { reasoning_effort: 'low' } : {}),
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const uid = await verifyIdToken(req)
  if (!uid) {
    res.status(401).json({ error: { code: 'unauthenticated' } })
    return
  }
  if (isRateLimited(uid)) {
    res.status(429).json({ error: 'Daily forecast limit reached' })
    return
  }

  const sanitized = sanitizeBody(req.body)
  if (!sanitized) {
    res.status(400).json({ error: 'Invalid forecast payload' })
    return
  }

  const groqKey = process.env.GROQ_API_KEY
  if (!groqKey) {
    res.status(500).json({ error: 'GROQ_API_KEY is not configured on the server' })
    return
  }

  let upstream
  try {
    upstream = await fetch(GROQ_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${groqKey}`,
      },
      body: JSON.stringify(sanitized),
    })
  } catch {
    res.status(502).json({ error: 'Groq could not be reached' })
    return
  }

  // Pass status + body through verbatim so the client's existing error-code
  // mapping (FIX-18) and parsing keep working unchanged.
  const text = await upstream.text()
  res.status(upstream.status)
  res.setHeader('Content-Type', 'application/json')
  res.send(text)
}

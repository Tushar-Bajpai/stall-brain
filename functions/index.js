// Firebase Callable Function: `forecast` (FIX-2, deploy-ready scaffold).
//
// Purpose: take the Groq API key OUT of the browser bundle. Phase 1.3 switches
// the client from `requestGroqForecast()`'s direct fetch to
// `httpsCallable(functions, 'forecast')`; the SDK attaches the signed-in user's
// ID token automatically, so this function rejects unauthenticated calls.
//
// Deploy (after `firebase init` / `firebase use --add`, on the Blaze plan):
//   firebase functions:secrets:set GROQ_API_KEY
//   firebase deploy --only functions
//
// Cost note: Auth + Firestore stay free on Blaze; Functions at this scale are
// effectively $0 — set a low budget alert anyway.

const { onCall, HttpsError } = require('firebase-functions/v2/https')
const { defineSecret } = require('firebase-functions/params')

const GROQ_API_KEY = defineSecret('GROQ_API_KEY')

const GROQ_ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions'

// Rate limit (Phase 1.3): max ~20 forecasts/day per user. A simple boot-level
// count is added in Phase 1; the scaffold forwards the request verbatim.
exports.forecast = onCall(
  { secrets: [GROQ_API_KEY], cors: true },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError(
        'unauthenticated',
        'Sign in to get a forecast.',
      )
    }

    // With the callable SDK the payload arrives already parsed. The client
    // sends the OpenAI-compatible body ({model, messages, ...}) directly.
    const body = request.data ?? {}
    if (!body?.messages || !body?.model) {
      throw new HttpsError(
        'invalid-argument',
        'Body must be an OpenAI-compatible chat-completions request.',
      )
    }

    let response
    try {
      response = await fetch(GROQ_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${GROQ_API_KEY.value()}`,
        },
        body: JSON.stringify(body),
      })
    } catch {
      throw new HttpsError(
        'unavailable',
        'Groq could not be reached from the function runtime.',
      )
    }

    if (response.status === 401 || response.status === 403) {
      throw new HttpsError(
        'permission-denied',
        'The Groq key set on the server was rejected (401/403).',
      )
    }
    if (response.status === 404) {
      throw new HttpsError(
        'not-found',
        'The configured Groq model was retired or renamed (404). Update GROQ_MODEL.',
      )
    }
    if (response.status === 429) {
      throw new HttpsError(
        'resource-exhausted',
        'Groq rate limit hit — retry in about a minute.',
      )
    }
    if (!response.ok) {
      throw new HttpsError(
        'internal',
        `Groq returned ${response.status}.`,
      )
    }

    // Pass the Groq response through verbatim so the client's existing
    // parsing/normalization and FIX-18 error copy keep working unchanged.
    return await response.json()
  },
)

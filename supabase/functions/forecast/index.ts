// Supabase Edge Function: forecast (FIX-2 scaffold, Phase 0 → deploy in Phase 1).
//
// Purpose: take the Groq API key OUT of the browser bundle. The frontend calls
// this function with the SAME body it used to send to Groq directly (OpenAI-
// compatible chat-completions shape). Once deployed, set VITE_FORECAST_URL to
// this function's URL in .env — requestGroqForecast() automatically switches
// to it and stops attaching Authorization.
//
// Deploy (after `supabase init && supabase link`):
//   supabase secrets set GROQ_API_KEY=gsk_...
//   supabase functions deploy forecast
//
// Security note: this proxy adds no moderation/rate-limit yet. Before opening
// it publicly (Phase 1), require the caller to hold a valid Supabase JWT
// (verify_jwt is on by default for functions) — Vercel users will need the
// anon key header.

const GROQ_ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*', // tighten to the app origin in Phase 1
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS })
  }
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: CORS_HEADERS })
  }

  const groqKey = Deno.env.get('GROQ_API_KEY')
  if (!groqKey) {
    return new Response(
      JSON.stringify({ error: 'GROQ_API_KEY secret is not configured' }),
      { status: 500, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } },
    )
  }

  let body
  try {
    body = await req.json()
  } catch {
    return new Response(
      JSON.stringify({ error: 'invalid JSON body' }),
      { status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } },
    )
  }

  const upstream = await fetch(GROQ_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${groqKey}`,
    },
    body: JSON.stringify(body),
  })

  // Pass through status + payload verbatim so the client's existing
  // error-code mapping (FIX-18) keeps working unchanged.
  const text = await upstream.text()
  return new Response(text, {
    status: upstream.status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  })
})

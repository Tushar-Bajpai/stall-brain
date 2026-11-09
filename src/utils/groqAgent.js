// Groq forecast agent — Phase 0 rework.
// FIX-10: quantities are requested and validated as numbers (unit kept separate).
// The LLM used to return "8 kg" free-tips and frequently failed arithmetic
// (toBuy ≠ totalNeeded − alreadyHave). We now coerce every number and repair the
// arithmetic ourselves before the UI ever sees it.
// FIX-17: model is configurable via VITE_GROQ_MODEL (Groq retires models — e.g.
// llama-3.3-70b-versatile → 404 — and only the model id changes).
// FIX-18: every failure surfaces a distinct code (401 ≠ 404 ≠ 429 ≠ network).
// FIX-2 (interim): if VITE_FORECAST_URL is set, requests go to that proxy
// (e.g. a Supabase Edge Function) and the browser never attaches the key.
// Once the proxy exists, move VITE_GROQ_API_KEY out of the client permanently.

const GROQ_ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions'
const DEFAULT_MODEL = 'openai/gpt-oss-120b'
const FALLBACK_MODEL = 'qwen/qwen3.8-27b'
const MAX_TOKENS = 1500
const TEMPERATURE = 0.2
const PRIORITY_VALUES = ['essential', 'moderate', 'optional']
const NUMERIC_TOLERANCE = 0.01

const SYSTEM_PROMPT = `You are Bazaar Brain, an AI demand forecaster for street vendors in Lucknow.
Respond ONLY in the following JSON format, with no markdown and no extra keys:
{
  "summary": "one sentence overview of today",
  "hindiSummary": "same in Hindi",
  "expectedCustomers": number,
  "peakHours": "e.g. 12-2pm and 6-9pm",
  "confidenceLevel": "High" | "Medium" | "Low",
  "confidenceReason": "short reason",
  "procurementList": [
    {
      "item": "aloo",
      "totalNeeded": 12,
      "alreadyHave": 4,
      "toBuy": 8,
      "unit": "kg",
      "priority": "essential",
      "note": "Optional short note"
    }
  ],
  "sufficientStockItems": ["imli chutney"],
  "specialAdvice": "English tip || Hindi tip"
}
Rules:
- specialAdvice must be one actionable tip in English, then "||", then the Hindi version.
- procurementList priorities must be one of: essential, moderate, optional.
- expectedCustomers, totalNeeded, alreadyHave, toBuy must be plain numbers (no units, no quotes, no ranges).
- The unit for every item must be one of the units the vendor used per item.
- toBuy must equal totalNeeded minus alreadyHave. never negative.
- If an item has sufficient stock, omit it from procurementList and list it in sufficientStockItems.
- Do not include any keys beyond the schema.`

function safeParseJson(content) {
  if (!content) return null
  const start = content.indexOf('{')
  const end = content.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) return null

  const slice = content.slice(start, end + 1)
  try {
    return JSON.parse(slice)
  } catch {
    return null
  }
}

// Defensive number coercion: models sometimes send "12 kg" strings anyway.
function toNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(0, value)
  }
  if (typeof value === 'string') {
    const match = value.match(/-?\d+(\.\d+)?/)
    if (match) {
      return Math.max(0, Number.parseFloat(match[0]))
    }
  }
  return null
}

function clampText(value, fallback = '', maxLength = 300) {
  if (typeof value !== 'string') return fallback
  const trimmed = value.trim()
  return trimmed ? trimmed.slice(0, maxLength) : fallback
}

function formatQuantity(quantity, unit) {
  const rounded = Math.round(quantity * 100) / 100
  const display = Number.isInteger(rounded) ? String(rounded) : String(rounded)
  return unit ? `${display} ${unit}` : display
}

function normalizeProcurementItem(raw, inventoryUnit) {
  if (!raw || typeof raw !== 'object') return null
  const item = clampText(raw.item, '', 80)
  if (!item) return null

  const totalNeeded = toNumber(raw.totalNeeded)
  const alreadyHave = toNumber(raw.alreadyHave)
  const unit = clampText(raw.unit, inventoryUnit || '', 16)

  // Repair arithmetic: toBuy must equal totalNeeded - alreadyHave.
  const buyTarget =
    totalNeeded !== null && alreadyHave !== null ? totalNeeded - alreadyHave : null
  let toBuy = toNumber(raw.toBuy)
  if (buyTarget !== null) {
    const corrected = Math.max(0, Math.round(buyTarget * 100) / 100)
    if (toBuy === null || Math.abs(toBuy - corrected) > NUMERIC_TOLERANCE) {
      toBuy = corrected
    }
  }
  if (toBuy === null && alreadyHave !== null) {
    toBuy = 0
  }
  if (totalNeeded === null && toBuy === null) return null

  const safeTotal = totalNeeded ?? (alreadyHave ?? 0) + toBuy
  const safeHave = alreadyHave ?? 0
  const safePriority = PRIORITY_VALUES.includes(raw?.priority)
    ? raw.priority
    : 'moderate'

  return {
    item,
    // Numeric truth (history / future analytics).
    totalNeededValue: Math.round(safeTotal * 100) / 100,
    alreadyHaveValue: Math.round(safeHave * 100) / 100,
    toBuyValue: Math.round(toBuy * 100) / 100,
    // Display strings keep ForecastOutput untouched (design stays identical).
    totalNeeded: formatQuantity(safeTotal, unit),
    alreadyHave: formatQuantity(safeHave, unit),
    toBuy: formatQuantity(toBuy, unit),
    unit,
    priority: safePriority,
    note: clampText(raw.note, '', 120),
  }
}

function normalizeForecast(parsed, inventory) {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return null
  }

  const rawList = Array.isArray(parsed.procurementList) ? parsed.procurementList : []
  const procurementList = rawList
    .map((entry) => {
      const unit = typeof entry?.unit === 'string' ? entry.unit : ''
      return normalizeProcurementItem(
        entry,
        inventory?.[entry?.item]?.unit || unit,
      )
    })
    .filter(Boolean)

  const sufficient = Array.isArray(parsed.sufficientStockItems)
    ? parsed.sufficientStockItems
        .map((item) => clampText(item, '', 80))
        .filter(Boolean)
    : []

  // An empty procurement list AND an empty sufficient list means the model
  // ignored the schema — treat it as a parse failure so the vendor can retry.
  if (!procurementList.length && !sufficient.length) return null

  const expectedCustomers = toNumber(parsed.expectedCustomers)
  const confidenceRaw = clampText(parsed.confidenceLevel, 'Medium', 12)
  const confidenceLevel = ['High', 'Medium', 'Low'].includes(confidenceRaw)
    ? confidenceRaw
    : 'Medium'

  return {
    summary: clampText(parsed.summary, "Today's plan is ready.", 400),
    hindiSummary: clampText(parsed.hindiSummary, parsed.summary, 400),
    expectedCustomers:
      expectedCustomers === null ? 0 : Math.round(expectedCustomers),
    peakHours: clampText(parsed.peakHours, 'Varies', 80),
    confidenceLevel,
    confidenceReason: clampText(parsed.confidenceReason, '', 200),
    procurementList,
    sufficientStockItems: sufficient,
    specialAdvice: clampText(parsed.specialAdvice, '', 500),
  }
}

function resolveModels() {
  const configured = import.meta.env.VITE_GROQ_MODEL
  if (configured) return [configured]
  return [DEFAULT_MODEL, FALLBACK_MODEL]
}

async function callGroq(model, apiKey, userPrompt, signal) {
  const proxyUrl = import.meta.env.VITE_FORECAST_URL
  const headers = { 'Content-Type': 'application/json' }
  if (!proxyUrl) {
    headers.Authorization = `Bearer ${apiKey}`
  }

  const response = await fetch(proxyUrl || GROQ_ENDPOINT, {
    method: 'POST',
    headers,
    signal,
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      temperature: TEMPERATURE,
      max_tokens: MAX_TOKENS,
      // gpt-oss spends tokens on hidden reasoning first; trim it so the JSON
      // never gets truncated by the token budget.
      ...(model.includes('gpt-oss') ? { reasoning_effort: 'low' } : {}),
    }),
  })

  if (!response.ok) {
    const body = await response.text().catch(() => '')
    let code = 'GROQ_REQUEST_FAILED'
    if (response.status === 401 || response.status === 403) {
      code = 'GROQ_AUTH_FAILED'
    } else if (
      response.status === 404 ||
      body.includes('model_not_found') ||
      body.includes('does not exist')
    ) {
      code = 'GROQ_MODEL_UNAVAILABLE'
    } else if (response.status === 429) {
      code = 'GROQ_RATE_LIMITED'
    }
    const error = new Error(code)
    error.code = code
    throw error
  }

  const data = await response.json()
  return data?.choices?.[0]?.message?.content
}

export async function requestGroqForecast({
  stall,
  items,
  inventory,
  dateLabel,
  dayName,
  weather,
  weatherSignal,
  eventSummary,
  weeklyMultiplier,
  eventMultiplier,
  demandMultiplier,
}) {
  const apiKey = import.meta.env.VITE_GROQ_API_KEY

  if (!import.meta.env.VITE_FORECAST_URL) {
    if (!apiKey || apiKey === 'your_groq_key_here') {
      const error = new Error('MISSING_API_KEY')
      error.code = 'MISSING_API_KEY'
      throw error
    }
  }

  const finalItems = Array.isArray(items) && items.length ? items : stall.items

  const inventoryLines = finalItems
    .map((item) => {
      const entry = inventory?.[item]
      const quantity = Number(entry?.quantity)
      const unit = entry?.unit || 'units'
      if (Number.isFinite(quantity) && quantity > 0) {
        return `${item}: ${quantity} ${unit} already in stock`
      }
      return `${item}: none in stock`
    })
    .join('\n')

  const userPrompt = `Stall type: ${stall.name}
Stock items: ${finalItems.join(', ')}
The vendor sells these specific items: ${finalItems.join(', ')}

VENDOR INVENTORY CONTEXT:
Stall Type: ${stall.name}
Today's items and current stock on hand:
${inventoryLines}

INSTRUCTIONS:
Generate procurement recommendations for the above items ONLY.
For each item, subtract what the vendor already has from the recommended total quantity.
If the vendor already has enough stock for the day, say "Sufficient stock" instead of recommending a purchase.
Never recommend items outside the vendor's list.
Be specific with quantities - do not give vague ranges.

Date: ${dateLabel}
Day of week: ${dayName}
Weather: ${weather.temperature}°C, ${weatherSignal.label}
Weather footfall impact: ${weatherSignal.footfallImpact}
Weather note: ${weatherSignal.recommendation}
Events today: ${eventSummary}
Event impact multiplier: ${eventMultiplier}
Weekly footfall multiplier for ${dayName}: ${weeklyMultiplier}
Combined demand multiplier (weather x event x day-of-week): ${demandMultiplier}
Use each item's stock unit for its numbers. Return precise procurement quantities and peak hours for Hazratganj, Lucknow.`

  // Model fallback: a retired model id returns 404, and the next candidate may
  // still be live (this exact outage already happened once).
  const models = resolveModels()
  let lastError = null

  for (const model of models) {
    try {
      const content = await callGroq(model, apiKey, userPrompt)
      const parsed = safeParseJson(content)
      const normalized = normalizeForecast(parsed, inventory)
      if (!normalized) {
        const error = new Error('GROQ_PARSE_FAILED')
        error.code = 'GROQ_PARSE_FAILED'
        throw error
      }
      return normalized
    } catch (error) {
      lastError = error
      // Only a retired/renamed model is worth retrying with a different id;
      // everything else (bad key, rate limit, network) fails the same way again.
      if (error?.code !== 'GROQ_MODEL_UNAVAILABLE') {
        throw error
      }
    }
  }

  throw lastError ?? new Error('GROQ_REQUEST_FAILED')
}

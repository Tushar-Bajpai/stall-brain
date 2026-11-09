<div align="center">

<img src="https://img.shields.io/badge/%20%C2%B7%20Hyperlocal%20Demand%20Forecasting-F59E0B?style=for-the-badge" />
&nbsp;

&nbsp;
<img src="https://img.shields.io/badge/Live-stall--brain.vercel.app-4ADE80?style=for-the-badge&logo=vercel&logoColor=white" href="https://stall-brain.vercel.app" />

<br /><br />

# 🧠 Bazaar Brain

### *रोज़ का हिसाब, AI का जवाब*
*Daily stock decisions, answered by AI*

**An agentic AI demand forecasting tool for street vendors in Hazratganj, Lucknow —**  
combining live weather, local events, and custom inventory to deliver daily procurement recommendations.

[**View Live Demo →**](https://stall-brain.vercel.app)

</div>

---

## 👥 Team Code Oxide

| Name | GitHub |
|------|--------|
| Tushar Bajpai | [@Tushar](https://github.com/Tushar-Bajpai) |
| Sankalp Saini | [@Sankalp](https://github.com/Arikalp) |
| Subrat Dwivedi | [@Subrat](https://github.com/subrat-dwi) |
| Utsav Singh | [@Utsav](https://github.com/githubutsav) |

**Repository:** [github.com/subrat-dwi/stall-brain](https://github.com/subrat-dwi/stall-brain)

---

## 🎯 Problem Statement 

> *"Hazratganj's iconic street market has vendors who over-stock or under-stock daily, leading to waste and lost revenue. Build an agent that reads footfall patterns, weather, local events, and social buzz to recommend optimal daily procurement."*
>
> **Lucknow context:** Hazratganj · Janpath Market

Every morning, thousands of street vendors in Hazratganj make the same high-stakes guess: **how much stock should I buy today?**

They have no tools. They rely on gut feel, last week's memory, and WhatsApp forwards. The consequences are real:

- A vendor overbought potatoes on a rainy day — the crowd never came, the stock rotted.
- The next day, fearing rain again, he bought less — but it was an LSG match day, the streets were packed, and he sold out by 4 PM, losing thousands in revenue.

This isn't bad luck. It's a **data problem**. The signals exist — weather forecasts, event calendars, day-of-week patterns — but no one has put them together for a Hazratganj vendor. Bazaar Brain does exactly that.

---

## 💡 Solution

Bazaar Brain is a **multi-page agentic web app** that acts as a daily procurement advisor for street vendors. A vendor picks their stall type, customizes their item list, and the AI agent synthesizes live weather data, a Lucknow-specific event calendar, and weekly footfall patterns to produce a precise, actionable stock recommendation — in English and Hindi.

The AI doesn't just answer a prompt. It **reasons across multiple data signals** before generating output, making it genuinely agentic rather than a simple chatbot.

---

## ✨ Features

**Vendor Auth & Persistent Profiles**
Users sign up, log in, and keep their stall profile saved across sessions.

**Stall Type Selection (7 types)**
Seven vendor archetypes tailored to Hazratganj: Chaat, Chai, Juice, Flowers, Bhutta, Snacks & Namkeen, Balloon & Toy.

**Editable Ingredient Lists**
Profile ingredients are fully editable: add, remove, or rename items before saving.

**Current Inventory Input**
Vendors enter what they already have per item (quantity + unit), so the AI recommends only what to buy today.

**Live Lucknow Weather (Open-Meteo)**
Real-time weather for Hazratganj coordinates drives footfall impact multipliers.

**Lucknow Event Radar**
Local events and weekly patterns feed the demand calculation before the AI prompt is built.

**Demand Multiplier Engine**
The system computes:

```
Demand Multiplier = Weather Impact × Event Impact × Day-of-Week Pattern
```

**Smart Procurement Output**
Each item returns Total Needed, You Have, and Buy Today with priorities and notes.

**Bilingual Output (EN + HI)**
Forecasts include English and Hindi summaries with a one-click toggle.

**Forecast History & Feedback Loop**
Runs are stored locally with feedback and inventory snapshots for future reference.

---

## 🗺️ App Flow

```
Landing  →  Profile Setup  →  Forecast Page  →  AI Output
(welcome)    (stall +          (inventory +       (buy today
			 ingredients)       session edits)    breakdown)
```

Your stall profile saves permanently. Each forecast lets you make temporary adjustments — add a seasonal item, remove something you're skipping today — without touching your saved profile.

---

## 🛠️ Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 19 + Vite |
| Styling | Tailwind CSS v4 + CSS Variables |
| Auth | Firebase (signup / login / session) |
| Routing | React Router v6 |
| AI / LLM | Groq API — `openai/gpt-oss-120b` (configurable via `VITE_GROQ_MODEL`) |
| Weather | Open-Meteo API (free, no key required) |
| Icons | Lucide React |
| Storage | Firebase (auth) + localStorage (forecast history, session) |
| Deployment | Vercel |

Coding Agent used : Copilot with GPT Codex


## 🏗️ Architecture

High-level: Client SPA → Signal Engine → Agent → LLM → UI & Storage

File structure:

```
src/
	App.jsx
	main.jsx
	pages/
		LandingPage.jsx
		HomePage.jsx
		LoginPage.jsx
		SignupPage.jsx
		ProfilePage.jsx
		ForecastPage.jsx
	components/
		Header.jsx
		StallSelector.jsx
		IngredientEditor.jsx
		InventoryInput.jsx
		SignalPanel.jsx
		LoadingState.jsx
		ForecastOutput.jsx
		FeedbackBar.jsx
		HistoryLog.jsx
	utils/
		groqAgent.js
		weatherLogic.js
		userScope.js
		profileStorage.js
		forecastSessionStore.js
		dateTime.js
		firebase.js
	data/
		stalls.js
		events.js
		marketSeeds.js
```

Data contracts:

```
UserProfile = {
	stallType,
	stallLabel,
	stallEmoji,
	ingredients[]
}

ForecastSession = {
	sessionIngredients[],
	inventory: { [item]: { quantity, unit } }
}

DemandMultiplier = {
	weather,
	event,
	weekday,
	combined
}

ProcurementItem = {
	item,
	totalNeeded,
	alreadyHave,
	toBuy,
	unit,
	priority,
	note
}

ForecastResult = {
	summary,
	hindiSummary,
	expectedCustomers,
	peakHours,
	confidenceLevel,
	confidenceReason,
	procurementList[],
	sufficientStockItems[],
	specialAdvice
}
```


---

## 🚀 Running Locally

**1. Clone the repository**
```bash
git clone https://github.com/subrat-dwi/stall-brain.git
cd stall-brain
```

**2. Add your API keys**

Copy the environment template and fill in the values:
```bash
cp .env.example .env
```
- **Firebase keys** (`VITE_FIREBASE_*`) — from Firebase console → Project settings → Your apps (powers signup / login)
- **Groq key** (`VITE_GROQ_API_KEY`) — get a free key at [console.groq.com](https://console.groq.com/); the value starts with `gsk_`, no quotes
- Optional: `VITE_GROQ_MODEL` overrides the AI model (`openai/gpt-oss-120b` by default — Groq occasionally retires model ids, and this keeps the swap to a config change, not a code hunt)

**3. Install and run**
```bash
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173).

---

## 🔭 What's Next

- **WhatsApp delivery** — send the daily forecast directly to a vendor's phone each morning
- **Crowdsourced social signals** — parse local hashtags like `#Hazratganj` and `#LucknowFoodies` to catch viral footfall spikes
- **Group buying** — aggregate demand across nearby vendors to unlock wholesale pricing on shared items
- **Revenue estimator** — vendor inputs selling price per item; app calculates expected daily earnings vs procurement cost

---

<div align="center">

Built with 💛 for the street vendors of Hazratganj, Lucknow.

*APL Hackathon 2026*

</div>

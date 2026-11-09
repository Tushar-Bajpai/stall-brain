const weatherMappings = [
  {
    codes: [0],
    label: 'Clear & Sunny ☀️',
    footfallImpact: 1.2,
    recommendation: 'Stock up, clear skies boost footfall.',
  },
  {
    codes: [1, 2, 3],
    label: 'Partly Cloudy ⛅',
    footfallImpact: 1.05,
    recommendation: 'Normal stocking with mild uplift.',
  },
  {
    codes: [45, 48],
    label: 'Foggy 🌫️',
    footfallImpact: 0.85,
    recommendation: 'Expect slower footfall early morning.',
  },
  {
    codes: [51, 53, 55, 56, 57, 61, 63, 65, 66, 67],
    label: 'Rain / Drizzle 🌧️',
    footfallImpact: 0.7,
    recommendation: 'Stock less; rain may reduce walk-ins.',
  },
  {
    codes: [80, 81, 82],
    label: 'Showers 🌦️',
    footfallImpact: 0.75,
    recommendation: 'Keep essentials; short showers expected.',
  },
  {
    codes: [95, 96, 99],
    label: 'Thunderstorm ⛈️',
    footfallImpact: 0.4,
    recommendation: 'Expect a sharp drop; keep essentials only.',
  },
]

export const WEATHER_UNAVAILABLE_SIGNAL = {
  label: 'Weather data unavailable',
  footfallImpact: 1,
  recommendation:
    'Open-Meteo could not be reached — planning for a regular demand day instead of guessing.',
}

export function getWeatherSignal(code) {
  const mapping = weatherMappings.find((entry) => entry.codes.includes(code))

  if (mapping) {
    return mapping
  }

  return {
    label: 'Weather Unknown',
    footfallImpact: 1,
    recommendation: 'Plan for regular demand.',
  }
}

/* ── Weather Service (Open-Meteo, free, no API key) ── */

/**
 * Fetch weather data for a given location and date.
 * @param {number} lat
 * @param {number} lng
 * @param {object} [options]
 * @param {string} [options.dateStr] - ISO date string (YYYY-MM-DD). Defaults to today.
 * @param {'midday'|'current'} [options.hourMode] - Which hour to pick from hourly data.
 * @returns {Promise<object|null>}
 */
export async function fetchWeather(lat, lng, { dateStr, hourMode = 'midday' } = {}) {
  if (!lat || !lng) return null;

  const today = new Date().toISOString().split('T')[0];
  const targetDate = dateStr && dateStr >= today ? dateStr : today;

  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}`
    + `&hourly=temperature_2m,windspeed_10m,winddirection_10m,precipitation_probability,visibility,weathercode`
    + `&start_date=${targetDate}&end_date=${targetDate}`
    + `&timezone=auto`;

  const response = await fetch(url);
  if (!response.ok) return null;

  const data = await response.json();
  if (!data.hourly || !data.hourly.time) return null;

  const hours = data.hourly.time;
  let bestIdx = 0;

  if (hourMode === 'current') {
    bestIdx = Math.min(new Date().getHours(), hours.length - 1);
  } else {
    // Pick midday (12:00) or closest
    for (let i = 0; i < hours.length; i++) {
      if (hours[i].includes('T12:00')) { bestIdx = i; break; }
      if (hours[i].includes('T13:00') || hours[i].includes('T11:00')) bestIdx = i;
    }
  }

  return {
    temperature: data.hourly.temperature_2m?.[bestIdx],
    windSpeed: data.hourly.windspeed_10m?.[bestIdx],
    windDirection: data.hourly.winddirection_10m?.[bestIdx],
    precipitationProb: data.hourly.precipitation_probability?.[bestIdx],
    visibility: data.hourly.visibility?.[bestIdx],
    weatherCode: data.hourly.weathercode?.[bestIdx],
    date: targetDate
  };
}

/**
 * Convert WMO weather code to icon SVG + label.
 */
export function weatherCodeToInfo(code) {
  const svgSun = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="20" height="20"><path d="M12 3v2m0 14v2m9-9h-2M5 12H3m15.364 6.364l-1.414-1.414M7.05 7.05L5.636 5.636m12.728 0l-1.414 1.414M7.05 16.95l-1.414 1.414M12 8a4 4 0 100 8 4 4 0 000-8z"/></svg>';
  const svgPartCloud = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="20" height="20"><path d="M2.25 15a4.5 4.5 0 004.5 4.5H18a3.75 3.75 0 001.332-7.257 3 3 0 00-3.758-3.848 5.25 5.25 0 00-10.233 2.33A4.502 4.502 0 002.25 15z"/></svg>';
  const svgCloud = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="20" height="20"><path d="M2.25 15a4.5 4.5 0 004.5 4.5H18a3.75 3.75 0 001.332-7.257 3 3 0 00-3.758-3.848 5.25 5.25 0 00-10.233 2.33A4.502 4.502 0 002.25 15z"/></svg>';
  const svgFog = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="20" height="20"><path d="M3.5 12h17M3.5 8h13M3.5 16h10"/></svg>';
  const svgRain = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="20" height="20"><path d="M2.25 15a4.5 4.5 0 004.5 4.5H18a3.75 3.75 0 001.332-7.257 3 3 0 00-3.758-3.848 5.25 5.25 0 00-10.233 2.33A4.502 4.502 0 002.25 15z"/><path d="M8 19v2m4-2v2m4-2v2" stroke-linecap="round"/></svg>';
  const svgSnow = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="20" height="20"><path d="M12 3v18m-6-9h12M6.34 6.34l11.32 11.32m0-11.32L6.34 17.66"/></svg>';
  const svgStorm = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="20" height="20"><path d="M2.25 15a4.5 4.5 0 004.5 4.5H18a3.75 3.75 0 001.332-7.257 3 3 0 00-3.758-3.848 5.25 5.25 0 00-10.233 2.33A4.502 4.502 0 002.25 15z"/><path d="M13 15l-2 5 4-3-2 5" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  const map = {
    0: { icon: svgSun, label: 'Clear Sky' },
    1: { icon: svgSun, label: 'Mainly Clear' },
    2: { icon: svgPartCloud, label: 'Partly Cloudy' },
    3: { icon: svgCloud, label: 'Overcast' },
    45: { icon: svgFog, label: 'Fog' },
    48: { icon: svgFog, label: 'Rime Fog' },
    51: { icon: svgRain, label: 'Light Drizzle' },
    53: { icon: svgRain, label: 'Drizzle' },
    55: { icon: svgRain, label: 'Heavy Drizzle' },
    61: { icon: svgRain, label: 'Light Rain' },
    63: { icon: svgRain, label: 'Rain' },
    65: { icon: svgRain, label: 'Heavy Rain' },
    71: { icon: svgSnow, label: 'Light Snow' },
    73: { icon: svgSnow, label: 'Snow' },
    75: { icon: svgSnow, label: 'Heavy Snow' },
    80: { icon: svgRain, label: 'Rain Showers' },
    81: { icon: svgRain, label: 'Moderate Showers' },
    82: { icon: svgStorm, label: 'Violent Showers' },
    95: { icon: svgStorm, label: 'Thunderstorm' },
    96: { icon: svgStorm, label: 'T-Storm w/ Hail' },
    99: { icon: svgStorm, label: 'Severe T-Storm' }
  };
  return map[code] || { icon: svgCloud, label: 'Unknown' };
}

/**
 * Convert wind direction degrees to compass string.
 */
export function windDirToCompass(deg) {
  const dirs = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  return dirs[Math.round(deg / 22.5) % 16];
}

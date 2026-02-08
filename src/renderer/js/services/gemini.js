/* ── Gemini AI Service ── */

/**
 * Retrieve the Gemini API key from the Electron preload bridge.
 */
export async function getGeminiApiKey() {
  let apiKey = '';
  try {
    if (window.helios?.getEnv) {
      apiKey = await window.helios.getEnv('GEMINI_API_KEY');
    }
  } catch (_) { /* ignore */ }
  return apiKey;
}

/**
 * Call the Gemini API and return parsed JSON.
 * @param {string} apiKey
 * @param {string} prompt
 * @returns {Promise<object>}
 */
export async function callGemini(apiKey, prompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.4, maxOutputTokens: 2048 }
    })
  });

  if (!response.ok) {
    const errBody = await response.json().catch(() => ({}));
    throw new Error(errBody?.error?.message || `Gemini API error (${response.status})`);
  }

  const data = await response.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';

  // Strip markdown fences if present
  const jsonStr = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
  try {
    return JSON.parse(jsonStr);
  } catch (e) {
    console.error('Gemini response parse error:', text);
    throw new Error('Failed to parse AI response. Please try again.');
  }
}

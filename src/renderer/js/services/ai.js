/* ── AI Provider Abstraction Layer ── */

/**
 * To add a new provider:
 *  1. Add its id/label entry to the PROVIDERS array
 *  2. Add default config values to DEFAULT_CONFIG
 *  3. Implement a _call<Provider>AI(config, prompt) function
 *  4. Add a case for it in callAI()
 *  5. Add a settings card in the Settings module (settings.js)
 */

import { callGemini } from './gemini.js';

export const AI_CONFIG_KEY = 'helios-ai-config';

export const PROVIDERS = [
  { id: 'gemini', label: 'Gemini', subtitle: 'Google Cloud AI' },
  { id: 'ollama', label: 'Ollama', subtitle: 'Local open-source models' }
];

export const GEMINI_MODELS = [
  { id: 'gemini-2.0-flash',      label: 'Gemini 2.0 Flash' },
  { id: 'gemini-2.0-flash-lite', label: 'Gemini 2.0 Flash Lite' },
  { id: 'gemini-1.5-pro',        label: 'Gemini 1.5 Pro' },
  { id: 'gemini-1.5-flash',      label: 'Gemini 1.5 Flash' }
];

const DEFAULT_CONFIG = {
  provider: 'gemini',
  gemini: { apiKey: '', model: 'gemini-2.0-flash' },
  ollama: { baseUrl: 'http://localhost:11434', model: '' }
};

/** Read AI config from localStorage (with safe defaults). */
export function getAIConfig() {
  try {
    const raw = localStorage.getItem(AI_CONFIG_KEY);
    if (raw) {
      const stored = JSON.parse(raw);
      return {
        ...DEFAULT_CONFIG,
        ...stored,
        gemini: { ...DEFAULT_CONFIG.gemini, ...(stored.gemini || {}) },
        ollama: { ...DEFAULT_CONFIG.ollama, ...(stored.ollama || {}) }
      };
    }
  } catch (_) { /* ignore */ }
  return {
    ...DEFAULT_CONFIG,
    gemini: { ...DEFAULT_CONFIG.gemini },
    ollama: { ...DEFAULT_CONFIG.ollama }
  };
}

/** Persist AI config to localStorage. */
export function setAIConfig(config) {
  localStorage.setItem(AI_CONFIG_KEY, JSON.stringify(config));
}

/** Returns a short display label for the active provider/model (e.g. for UI badges). */
export function getAIProviderLabel() {
  const config = getAIConfig();
  if (config.provider === 'ollama') {
    return config.ollama.model ? `Ollama · ${config.ollama.model}` : 'Ollama';
  }
  const modelEntry = GEMINI_MODELS.find(m => m.id === (config.gemini?.model || 'gemini-2.0-flash'));
  return modelEntry ? modelEntry.label : 'Gemini';
}

/**
 * Call the configured AI provider with a prompt and return parsed JSON.
 * @param {string} prompt
 * @returns {Promise<object>}
 */
export async function callAI(prompt) {
  const config = getAIConfig();

  if (config.provider === 'ollama') {
    return _callOllamaAI(config, prompt);
  }

  return _callGeminiAI(config, prompt);
}

// ── Internal provider implementations ──────────────────────────────────────

async function _callGeminiAI(config, prompt) {
  let apiKey = config.gemini.apiKey || '';

  // Fall back to env var if no key stored in settings
  if (!apiKey && window.helios?.getEnv) {
    apiKey = await window.helios.getEnv('GEMINI_API_KEY');
  }

  if (!apiKey) {
    throw new Error('Gemini API key not configured. Go to Settings to add your API key.');
  }

  const model = config.gemini.model || 'gemini-2.0-flash';
  return callGemini(apiKey, prompt, model);
}

async function _callOllamaAI(config, prompt) {
  const model = config.ollama.model;
  if (!model) {
    throw new Error('No Ollama model selected. Go to Settings to choose a model.');
  }

  const baseUrl = config.ollama.baseUrl || 'http://localhost:11434';

  if (!window.helios?.ollamaGenerate) {
    throw new Error('Ollama is not available in this environment.');
  }

  const result = await window.helios.ollamaGenerate(baseUrl, model, prompt);

  if (!result.success) {
    throw new Error(result.error || 'Ollama request failed. Is Ollama running?');
  }

  const text = result.text || '';
  const jsonStr = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();

  try {
    return JSON.parse(jsonStr);
  } catch (e) {
    console.error('[AI] Ollama response parse error:', text);
    throw new Error('Failed to parse AI response. Please try again.');
  }
}

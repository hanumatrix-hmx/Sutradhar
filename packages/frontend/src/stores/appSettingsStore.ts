/**
 * @file packages/frontend/src/stores/appSettingsStore.ts
 * @description Small persisted app-preference store (Servant Model defaults).
 *
 * Kept separate from llmSettingsStore: these are behavioural preferences,
 * not provider configuration. Defaults favour "things come to the user":
 * runs start automatically once the backend is ready.
 */

export interface AppSettings {
  /** Start the agent run automatically when the backend session is ready. */
  autoStartRuns: boolean;
}

const STORAGE_KEY = 'sutradhar_app_settings_v1';

export const DEFAULT_APP_SETTINGS: AppSettings = {
  autoStartRuns: true,
};

export function loadAppSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      return { ...DEFAULT_APP_SETTINGS, ...(JSON.parse(raw) as Partial<AppSettings>) };
    }
  } catch {
    // Corrupt or unavailable storage — fall through to defaults.
  }
  return { ...DEFAULT_APP_SETTINGS };
}

export function saveAppSettings(settings: AppSettings): AppSettings {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Storage quota exceeded or disabled — preference stays in-memory only.
  }
  return settings;
}

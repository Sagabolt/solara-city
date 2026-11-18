// Solara City — save / load through localStorage. One save slot holds the
// story state (cash, mission, step, player spot, wanted level) plus the
// audio setting; settings live in their own key so a New Game keeps the
// mute choice. Every read is guarded: a missing or corrupt entry just
// means "no save", never a crash.

const SAVE_KEY = 'solara-city-save-v1';
const SETTINGS_KEY = 'solara-city-settings-v1';

export function createSave() {
  return {
    hasSave() {
      try {
        return !!localStorage.getItem(SAVE_KEY);
      } catch (err) {
        return false;
      }
    },

    save(data) {
      try {
        localStorage.setItem(
          SAVE_KEY,
          JSON.stringify({ ...data, version: 1, savedAt: Date.now() }),
        );
        return true;
      } catch (err) {
        return false;
      }
    },

    load() {
      try {
        const raw = localStorage.getItem(SAVE_KEY);
        if (!raw) return null;
        const data = JSON.parse(raw);
        if (!data || typeof data !== 'object' || data.version !== 1) return null;
        return data;
      } catch (err) {
        return null;
      }
    },

    clear() {
      try {
        localStorage.removeItem(SAVE_KEY);
      } catch (err) { /* no save is a fine state to be in */ }
    },

    loadSettings() {
      try {
        const raw = localStorage.getItem(SETTINGS_KEY);
        if (!raw) return { muted: false };
        const parsed = JSON.parse(raw);
        return { muted: !!(parsed && parsed.muted) };
      } catch (err) {
        return { muted: false };
      }
    },

    saveSettings(settings) {
      try {
        localStorage.setItem(
          SETTINGS_KEY,
          JSON.stringify({ muted: !!(settings && settings.muted) }),
        );
        return true;
      } catch (err) {
        return false;
      }
    },
  };
}

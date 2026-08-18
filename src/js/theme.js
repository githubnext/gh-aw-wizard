// Theme toggling — keeps the Primer color mode in sync with the user preference.

var THEME_STORAGE_KEY = 'gh-aw-wizard-theme';
var THEME_MODES = ['auto', 'light', 'dark'];
var THEME_COPY = {
  auto: { label: 'Auto theme', icon: '◐' },
  light: { label: 'Light theme', icon: '☀️' },
  dark: { label: 'Dark theme', icon: '☾' }
};

var themeMode = 'auto';

export function normalizeThemeMode(mode) {
  return THEME_MODES.indexOf(mode) === -1 ? 'auto' : mode;
}

export function nextThemeMode(mode) {
  return mode === 'auto' ? 'light' : mode === 'light' ? 'dark' : 'auto';
}

export function resolveColorMode(mode, systemDark) {
  return mode === 'auto' ? (systemDark ? 'dark' : 'light') : mode;
}

export function themeCopy(mode) {
  return THEME_COPY[mode] || THEME_COPY.auto;
}

export function applyTheme(mode) {
  themeMode = mode;
  var systemDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.setAttribute('data-theme-preference', mode);
  document.documentElement.setAttribute('data-color-mode', resolveColorMode(mode, systemDark));

  var label = document.getElementById('theme-toggle-label');
  var toggle = document.getElementById('theme-toggle');
  var icon = document.querySelector('.theme-toggle-icon');
  var state = themeCopy(mode);
  if (label) label.textContent = state.label;
  if (icon) icon.textContent = state.icon;
  if (toggle) {
    toggle.setAttribute('title', state.label + '. Click to change.');
  }
}

export function initTheme() {
  themeMode = normalizeThemeMode(document.documentElement.getAttribute('data-theme-preference') || 'auto');
  applyTheme(themeMode);

  var toggle = document.getElementById('theme-toggle');
  if (!toggle) return;
  toggle.addEventListener('click', function () {
    var next = nextThemeMode(themeMode);
    applyTheme(next);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch (e) {
      // Ignore storage failures; the selected theme still applies for this page load.
    }
  });

  if (window.matchMedia) {
    var media = window.matchMedia('(prefers-color-scheme: dark)');
    var updateAutoTheme = function () {
      if (themeMode === 'auto') applyTheme('auto');
    };
    if (media.addEventListener) media.addEventListener('change', updateAutoTheme);
    else if (media.addListener) media.addListener(updateAutoTheme);
  }
}

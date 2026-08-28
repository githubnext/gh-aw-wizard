// Landing page: a minimal hero that hands over to the wizard on interaction.

const LEAVE_DURATION = 300;

export function initLanding(onReveal) {
  const landing = document.getElementById('landing');
  const button = document.getElementById('btn-get-started');
  if (!landing || !button) {
    showWizard();
    return;
  }
  button.addEventListener('click', () => {
    startWizard(landing, onReveal);
  });
  window.addEventListener('popstate', (event) => {
    // Only react to entries this app pushed, and only while the wizard is
    // showing, so unrelated history entries never bounce the user back.
    if (!event.state || event.state.started) return;
    if (!document.documentElement.classList.contains('wizard-revealed')) return;
    showLanding(landing);
  });
}

function startWizard(landing, onReveal) {
  if (!document.documentElement.classList.contains('is-landing')) return;
  window.history.pushState({ step: 1, started: true }, '');
  landing.classList.add('is-leaving');
  window.setTimeout(() => {
    landing.classList.remove('is-leaving');
    showWizard();
    if (typeof onReveal === 'function') onReveal();
  }, prefersReducedMotion() ? 0 : LEAVE_DURATION);
}

function showWizard() {
  document.documentElement.classList.remove('is-landing');
  document.documentElement.classList.add('wizard-revealed');
}

function showLanding(landing) {
  document.documentElement.classList.add('is-landing');
  document.documentElement.classList.remove('wizard-revealed');
  landing.classList.remove('is-leaving');
}

function prefersReducedMotion() {
  return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
}

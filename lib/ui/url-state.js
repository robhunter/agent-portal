// url-state.js — URL state management for Bobbo-style project navigation
// Encodes project + tab + output as query params, supports back/forward

/**
 * Get the URL state management client-side JS string.
 * Requires the project sidebar JS to be loaded first (currentSlug, currentTab, etc.)
 */
function getURLStateJS() {
  return `
let suppressPushState = false;

function pushURLState() {
  if (suppressPushState) return;
  const state = { slug: currentSlug, tab: currentTab, outputFile: typeof currentOutputFile !== 'undefined' ? currentOutputFile : null };
  const params = new URLSearchParams();
  if (currentSlug) params.set('project', currentSlug);
  if (currentTab && currentTab !== 'journal') params.set('tab', currentTab);
  if (state.outputFile) params.set('output', state.outputFile);
  if (!currentSlug && !state.outputFile) {
    const logItem = document.getElementById('bobbo-log-item');
    if (logItem && logItem.classList.contains('active')) {
      params.set('view', 'log');
    }
  }
  const qs = params.toString();
  const url = qs ? '?' + qs : '/';
  history.pushState(state, '', url);
}

window.addEventListener('popstate', async function(e) {
  suppressPushState = true;
  if (e.state && e.state.slug) {
    currentSlug = e.state.slug;
    currentTab = e.state.tab || 'journal';
    if (typeof currentOutputFile !== 'undefined') currentOutputFile = e.state.outputFile || null;
    const logItem = document.getElementById('bobbo-log-item');
    if (logItem) logItem.classList.remove('active');
    renderSidebar();
    document.getElementById('tabs').style.display = 'flex';
    document.querySelectorAll('.tab').forEach(function(t) {
      t.classList.toggle('active', t.dataset.tab === currentTab);
    });
    const loader = TAB_LOADERS[currentTab];
    if (loader) await loader();
  } else {
    await selectBobboLog();
  }
  suppressPushState = false;
});

// Override selectProject/selectBobboLog/switchTab to push URL state
const _origSelectProject = selectProject;
selectProject = async function(slug) {
  await _origSelectProject(slug);
  pushURLState();
};

const _origSelectBobboLog = selectBobboLog;
selectBobboLog = async function() {
  await _origSelectBobboLog();
  pushURLState();
};

const _origSwitchTab = switchTab;
switchTab = function(tab) {
  _origSwitchTab(tab);
  pushURLState();
};

async function initFromURL() {
  const params = new URLSearchParams(window.location.search);
  const slug = params.get('project');
  const tab = params.get('tab') || 'journal';
  const outputFile = params.get('output');
  const view = params.get('view');

  suppressPushState = true;
  if (slug) {
    currentSlug = slug;
    currentTab = tab;
    if (typeof currentOutputFile !== 'undefined') currentOutputFile = outputFile || null;
    const logItem = document.getElementById('bobbo-log-item');
    if (logItem) logItem.classList.remove('active');
    renderSidebar();
    document.getElementById('tabs').style.display = 'flex';
    document.querySelectorAll('.tab').forEach(function(t) {
      t.classList.toggle('active', t.dataset.tab === currentTab);
    });
    const loader = TAB_LOADERS[currentTab];
    if (loader) await loader();
    if (outputFile && typeof viewOutput === 'function') await viewOutput(outputFile);
  } else if (view === 'log') {
    await selectBobboLog();
  }
  suppressPushState = false;
  history.replaceState({ slug: currentSlug, tab: currentTab, outputFile: typeof currentOutputFile !== 'undefined' ? currentOutputFile : null }, '', window.location.href);
}
`;
}

module.exports = { getURLStateJS };

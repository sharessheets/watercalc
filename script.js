// ========== AUTH0 CONFIG ==========
//
// These must match your Auth0 tenant & API settings.
const AUTH0_DOMAIN = 'dev-yncppqxbhx4m1lbd.us.auth0.com';
const AUTH0_CLIENT_ID = 'Ij2XpgNkCg7FBPXJYA7dCBiaKNO3qi4O';
// MUST match the API Identifier you created in Auth0 → APIs.
const AUTH0_AUDIENCE = 'https://proof-calc-api';

// ========== API CONFIG ==========
//
// Cloudflare Worker URL.
const API_BASE_URL = 'https://proof-calc-worker.sharessheets.workers.dev';

// Auth0 client + token cache
let auth0Client = null;
let idToken = null; // cached Auth0 access token (JWT)

// ========== LOCAL STORAGE LOG ==========

let logEntries = [];

function loadLogFromStorage() {
  try {
    const raw = localStorage.getItem('calcLog');
    if (!raw) {
      logEntries = [];
      return;
    }
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      logEntries = parsed;
    } else {
      logEntries = [];
    }
  } catch (err) {
    console.warn('Failed to load calcLog from localStorage:', err);
    logEntries = [];
  }
}

function saveLogToStorage() {
  try {
    localStorage.setItem('calcLog', JSON.stringify(logEntries));
  } catch (err) {
    console.warn('Failed to save calcLog to localStorage:', err);
  }
}

function appendLogEntry(entry) {
  logEntries.push(entry);
  saveLogToStorage();
}

function clearLog() {
  logEntries = [];
  saveLogToStorage();
  renderLog();
}

function renderLog() {
  const outEl = document.getElementById('logOutput');
  if (!outEl) return;

  if (!logEntries.length) {
    outEl.textContent = '(no entries yet)';
    return;
  }

  const lines = logEntries.map((entry, idx) => {
    const ts = entry.timestamp || '';
    if (entry.type === 'top') {
      return [
        `#${idx + 1} [TOP] ${ts}`,
        `  Weight (B2):      ${entry.weightTop}`,
        `  Proof (B4):       ${entry.proofTop}`,
        `  PG Conv (B5):     ${formatPgConv(entry.pgConv)}`,
        `  2nd H2O (B6):     ${formatSecondH2O(entry.secondH2O)}`,
        `  2nd Weight (B8):  ${formatNewWeight(entry.newWeight)}`,
        ''
      ].join('\n');
    } else if (entry.type === 'bottom') {
      return [
        `#${idx + 1} [BOTTOM] ${ts}`,
        `  Dist Weight (B13): ${entry.distWeight}`,
        `  Dist PF (B15):     ${entry.distPF}`,
        `  PG Conv (B16):     ${formatPgConv(entry.pgConv)}`,
        `  1st H2O (B17):     ${formatSecondH2O(entry.firstH2O)}`,
        ''
      ].join('\n');
    } else if (entry.type === 'variable') {
      return [
        `#${idx + 1} [VARIABLE] ${ts}`,
        `  Weight:            ${entry.weight}`,
        `  Current Proof:     ${entry.proofCurrent}`,
        `  Target Proof:      ${entry.proofTarget}`,
        `  Curr PG Conv:      ${formatPgConv(entry.currentPgConv)}`,
        `  Target PG Conv:    ${formatPgConv(entry.targetPgConv)}`,
        `  Water to Add:      ${formatSecondH2O(entry.secondH2O)}`,
        `  New Weight:        ${formatNewWeight(entry.newWeight)}`,
        ''
      ].join('\n');
    } else {
      return `#${idx + 1} [UNKNOWN] ${ts}`;
    }
  });

  outEl.textContent = lines.join('\n');
}

// ========== FORMATTING HELPERS (UI ONLY) ==========

function formatPgConv(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return '';
  return num.toFixed(5); // keep trailing zeros
}

function formatSecondH2O(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return '';
  return num.toFixed(2);
}

function formatNewWeight(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return '';
  return Math.round(num).toLocaleString('en-US');
}

// ========== AUTH0 HELPERS ==========

async function initAuth0() {
  if (!window.createAuth0Client) {
    console.error('Auth0 SPA SDK not loaded. Make sure auth0-spa-js is included.');
    return;
  }

  auth0Client = await window.createAuth0Client({
    domain: AUTH0_DOMAIN,
    clientId: AUTH0_CLIENT_ID,
    authorizationParams: {
      audience: AUTH0_AUDIENCE,
      redirect_uri: window.location.origin
    }
  });

  // Handle the redirect back from Auth0
  if (window.location.search.includes('code=') && window.location.search.includes('state=')) {
    try {
      await auth0Client.handleRedirectCallback();
    } catch (err) {
      console.error('Error handling Auth0 redirect callback:', err);
    } finally {
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }
}

async function refreshAuthState() {
  const btnLogin = document.getElementById('btnLogin');
  const btnLogout = document.getElementById('btnLogout');
  const app = document.getElementById('app');
  const authStatus = document.getElementById('authStatus');

  if (!auth0Client) {
    console.warn('Auth0 client not initialized yet.');
    return;
  }

  const isAuthenticated = await auth0Client.isAuthenticated();

  if (isAuthenticated) {
    if (btnLogin) btnLogin.style.display = 'none';
    if (btnLogout) btnLogout.style.display = 'inline-block';
    if (app) app.style.display = 'block';

    try {
      idToken = await auth0Client.getTokenSilently();
    } catch (err) {
      console.error('Failed to get Auth0 token silently:', err);
      idToken = null;
    }

    if (authStatus) authStatus.textContent = 'Logged in';
  } else {
    if (btnLogin) btnLogin.style.display = 'inline-block';
    if (btnLogout) btnLogout.style.display = 'none';
    if (app) app.style.display = 'none';
    idToken = null;
    if (authStatus) authStatus.textContent = 'Not logged in';
  }
}

async function handleLogin() {
  if (!auth0Client) {
    console.error('Auth0 client not initialized.');
    return;
  }
  await auth0Client.loginWithRedirect({
    authorizationParams: {
      audience: AUTH0_AUDIENCE,
      redirect_uri: window.location.origin
    }
  });
}

async function handleLogout() {
  if (!auth0Client) {
    console.error('Auth0 client not initialized.');
    return;
  }
  await auth0Client.logout({
    logoutParams: {
      returnTo: window.location.origin
    }
  });
}

// ========== API CALL HELPER ==========

async function callApi(path, payload) {
  if (!API_BASE_URL) {
    throw new Error('API_BASE_URL is not configured in script.js');
  }

  const headers = {
    'Content-Type': 'application/json'
  };

  // Attach Auth0 token if we have one
  if (idToken) {
    headers['Authorization'] = `Bearer ${idToken}`;
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload ?? {})
  });

  let data;
  try {
    data = await response.json();
  } catch (err) {
    throw new Error(`Failed to parse JSON from ${path}: ${err.message}`);
  }

  if (!response.ok) {
    const msg = data && data.error ? data.error : response.statusText;
    throw new Error(msg);
  }

  return data;
}

// ========== CALC HANDLERS ==========

// Top calculator (80 PF fixed)
async function handleCalcTop() {
  const weightInput = document.getElementById('weightTop');
  const proofInput = document.getElementById('proofTop');
  const pgConvSpan = document.getElementById('pgConvTop');
  const secondH2OSpan = document.getElementById('secondH2OTop');
  const newWeightSpan = document.getElementById('newWeightTop');

  if (!weightInput || !proofInput || !pgConvSpan || !secondH2OSpan || !newWeightSpan) {
    alert('Top calculator elements not found.');
    return;
  }

  const weightStr = weightInput.value.trim();
  const proofStr = proofInput.value.trim();

  if (!weightStr || !proofStr) {
    alert('Please enter both weight and proof.');
    return;
  }

  const weightNum = Number(weightStr);
  if (!Number.isFinite(weightNum)) {
    alert('Weight must be a valid number.');
    return;
  }

  try {
    const result = await callApi('/calc/top', {
      weight: weightStr,
      proof: proofStr
    });

    if (!result || result.ok === false) {
      const msg = result && result.error ? result.error : 'Unknown error.';
      throw new Error(msg);
    }

    pgConvSpan.textContent = formatPgConv(result.pgConv);
    secondH2OSpan.textContent = formatSecondH2O(result.secondH2O);
    newWeightSpan.textContent = formatNewWeight(result.newWeight);

    appendLogEntry({
      type: 'top',
      timestamp: new Date().toISOString(),
      weightTop: weightStr,
      proofTop: proofStr,
      pgConv: result.pgConv,
      secondH2O: result.secondH2O,
      newWeight: result.newWeight
    });

    renderLog();
  } catch (err) {
    console.error(err);
    alert(`Top calculation failed: ${err.message}`);
  }
}

// Bottom calculator (1st water)
async function handleCalcBottom() {
  const distWeightInput = document.getElementById('distWeight');
  const distPFInput = document.getElementById('distPF');
  const pgConvSpan = document.getElementById('pgConvBottom');
  const firstH2OSpan = document.getElementById('firstH2O');

  if (!distWeightInput || !distPFInput || !pgConvSpan || !firstH2OSpan) {
    alert('Bottom calculator elements not found.');
    return;
  }

  const distWeightStr = distWeightInput.value.trim();
  const distPFStr = distPFInput.value.trim();

  if (!distWeightStr || !distPFStr) {
    alert('Please enter both distilled weight and distilled PF.');
    return;
  }

  const distWeightNum = Number(distWeightStr);
  if (!Number.isFinite(distWeightNum)) {
    alert('Distilled weight must be a valid number.');
    return;
  }

  try {
    const result = await callApi('/calc/bottom', {
      distWeight: distWeightStr,
      distPF: distPFStr
    });

    if (!result || result.ok === false) {
      const msg = result && result.error ? result.error : 'Unknown error.';
      throw new Error(msg);
    }

    pgConvSpan.textContent = formatPgConv(result.pgConv);
    firstH2OSpan.textContent = formatSecondH2O(result.firstH2O);

    appendLogEntry({
      type: 'bottom',
      timestamp: new Date().toISOString(),
      distWeight: distWeightStr,
      distPF: distPFStr,
      pgConv: result.pgConv,
      firstH2O: result.firstH2O
    });

    renderLog();
  } catch (err) {
    console.error(err);
    alert(`Bottom calculation failed: ${err.message}`);
  }
}

// Variable proof calculator
async function handleCalcVariable() {
  const weightInput = document.getElementById('varWeight');
  const proofCurrentInput = document.getElementById('varProofCurrent');
  const proofTargetInput = document.getElementById('varProofTarget');
  const pgConvCurrentSpan = document.getElementById('varPgConvCurrent');
  const pgConvTargetSpan = document.getElementById('varPgConvTarget');
  const h2OSpan = document.getElementById('varH2O');
  const newWeightSpan = document.getElementById('varNewWeight');

  if (
    !weightInput ||
    !proofCurrentInput ||
    !proofTargetInput ||
    !pgConvCurrentSpan ||
    !pgConvTargetSpan ||
    !h2OSpan ||
    !newWeightSpan
  ) {
    alert('Variable proof calculator elements not found.');
    return;
  }

  const weightStr = weightInput.value.trim();
  const proofCurrentStr = proofCurrentInput.value.trim();
  const proofTargetStr = proofTargetInput.value.trim();

  if (!weightStr || !proofCurrentStr || !proofTargetStr) {
    alert('Please enter weight, current proof, and target proof.');
    return;
  }

  const weightNum = Number(weightStr);
  if (!Number.isFinite(weightNum)) {
    alert('Weight must be a valid number.');
    return;
  }

  try {
    const result = await callApi('/calc/variable', {
      weight: weightStr,
      proof: proofCurrentStr,
      targetProof: proofTargetStr
    });

    if (!result || result.ok === false) {
      const msg = result && result.error ? result.error : 'Unknown error.';
      throw new Error(msg);
    }

    pgConvCurrentSpan.textContent = formatPgConv(result.currentPgConv);
    pgConvTargetSpan.textContent = formatPgConv(result.targetPgConv);
    h2OSpan.textContent = formatSecondH2O(result.secondH2O);
    newWeightSpan.textContent = formatNewWeight(result.newWeight);

    appendLogEntry({
      type: 'variable',
      timestamp: new Date().toISOString(),
      weight: weightStr,
      proofCurrent: proofCurrentStr,
      proofTarget: proofTargetStr,
      currentPgConv: result.currentPgConv,
      targetPgConv: result.targetPgConv,
      secondH2O: result.secondH2O,
      newWeight: result.newWeight
    });

    renderLog();
  } catch (err) {
    console.error(err);
    alert(`Variable proof calculation failed: ${err.message}`);
  }
}

// ========== TABS ==========

function initTabs() {
  const btnTabTop = document.getElementById('btnTabTop');
  const btnTabBottom = document.getElementById('btnTabBottom');
  const btnTabVariable = document.getElementById('btnTabVariable');

  const panelTop = document.getElementById('panelTop');
  const panelBottom = document.getElementById('panelBottom');
  const panelVariable = document.getElementById('panelVariable');

  if (!btnTabTop || !btnTabBottom || !btnTabVariable || !panelTop || !panelBottom || !panelVariable) {
    console.warn('Tab elements not found; skipping tab init.');
    return;
  }

  function showPanel(name) {
    btnTabTop.classList.toggle('active', name === 'top');
    btnTabBottom.classList.toggle('active', name === 'bottom');
    btnTabVariable.classList.toggle('active', name === 'variable');

    panelTop.style.display = name === 'top' ? 'block' : 'none';
    panelBottom.style.display = name === 'bottom' ? 'block' : 'none';
    panelVariable.style.display = name === 'variable' ? 'block' : 'none';
  }

  btnTabTop.addEventListener('click', (e) => {
    e.preventDefault();
    showPanel('top');
  });

  btnTabBottom.addEventListener('click', (e) => {
    e.preventDefault();
    showPanel('bottom');
  });

  btnTabVariable.addEventListener('click', (e) => {
    e.preventDefault();
    showPanel('variable');
  });

  // Default
  showPanel('top');
}

// ========== INIT UI ==========

function initCalculatorUI() {
  loadLogFromStorage();
  renderLog();

  const btnCalcTop = document.getElementById('btnCalcTop');
  const btnCalcBottom = document.getElementById('btnCalcBottom');
  const btnCalcVariable = document.getElementById('btnCalcVariable');
  const btnViewLog = document.getElementById('btnViewLog');
  const btnClearLog = document.getElementById('btnClearLog');
  const btnLogin = document.getElementById('btnLogin');
  const btnLogout = document.getElementById('btnLogout');

  if (btnCalcTop) {
    btnCalcTop.addEventListener('click', () => {
      handleCalcTop();
    });
  }

  if (btnCalcBottom) {
    btnCalcBottom.addEventListener('click', () => {
      handleCalcBottom();
    });
  }

  if (btnCalcVariable) {
    btnCalcVariable.addEventListener('click', () => {
      handleCalcVariable();
    });
  }

  if (btnViewLog) {
    btnViewLog.addEventListener('click', () => {
      renderLog();
    });
  }

  if (btnClearLog) {
    btnClearLog.addEventListener('click', () => {
      clearLog();
    });
  }

  if (btnLogin) {
    btnLogin.addEventListener('click', (e) => {
      e.preventDefault();
      handleLogin();
    });
  }

  if (btnLogout) {
    btnLogout.addEventListener('click', (e) => {
      e.preventDefault();
      handleLogout();
    });
  }

  initTabs();
}

// ========== BOOTSTRAP ==========

window.addEventListener('DOMContentLoaded', async () => {
  try {
    await initAuth0();
  } catch (err) {
    console.error('Error during Auth0 initialization:', err);
  }

  initCalculatorUI();
  await refreshAuthState();
});

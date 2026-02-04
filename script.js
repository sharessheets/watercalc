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

let auth0Client = null;
let idToken = null; // cached Auth0 access token (JWT)

// ========== LOG STATE ==========
let logEntries = [];

// ========== FORMAT HELPERS ==========

function formatPgConv(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    return String(value ?? '');
  }
  // Always show 5 decimal places, including trailing zeros
  return n.toFixed(5);
}

function isValidThreeDecimalProof(str) {
  if (typeof str !== 'string') return false;

  // Normalize whitespace and unicode oddities
  const clean = str
    .trim()
    .replace(/\s+/g, '')
    .normalize('NFKC');

  return /^[0-9]+\.[0-9]{3}$/.test(clean);
}

function formatSecondH2O(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    return String(value ?? '');
  }
  // Round to hundredths
  return n.toFixed(2);
}

function formatNewWeight(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    return String(value ?? '');
  }
  // Round to whole number and add thousands separators
  return Math.round(n).toLocaleString('en-US');
}

// ========== AUTH0 INITIALIZATION ==========

async function initAuth0() {
  if (!window.auth0) {
    console.error('Auth0 SPA SDK not loaded.');
    return;
  }

  auth0Client = await auth0.createAuth0Client({
    domain: AUTH0_DOMAIN,
    clientId: AUTH0_CLIENT_ID,
    authorizationParams: {
      redirect_uri: window.location.origin + window.location.pathname,
      audience: AUTH0_AUDIENCE,
    },
    cacheLocation: 'localstorage',
    useRefreshTokens: true,
  });

  // Handle redirect callback (after login)
  const query = window.location.search;
  if (query.includes('code=') && query.includes('state=')) {
    try {
      await auth0Client.handleRedirectCallback();
    } catch (err) {
      console.error('Auth0 redirect error:', err);
    } finally {
      // Clean URL
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }

  await refreshAuthState();
}

async function refreshAuthState() {
  if (!auth0Client) return;

  const isAuthenticated = await auth0Client.isAuthenticated();
  const btnLogin = document.getElementById('btnLogin');
  const btnLogout = document.getElementById('btnLogout');
  const authStatus = document.getElementById('authStatus');
  const app = document.getElementById('app');

  if (isAuthenticated) {
    try {
      idToken = await auth0Client.getTokenSilently();
    } catch (err) {
      console.error('Error getting token silently:', err);
      idToken = null;
    }

    if (btnLogin) btnLogin.style.display = 'none';
    if (btnLogout) btnLogout.style.display = 'inline-block';
    if (authStatus) authStatus.textContent = 'Logged in';
    if (app) app.style.display = 'block';
  } else {
    idToken = null;
    if (btnLogin) btnLogin.style.display = 'inline-block';
    if (btnLogout) btnLogout.style.display = 'none';
    if (authStatus) authStatus.textContent = 'Not logged in';
    if (app) app.style.display = 'none';
  }
}

async function handleLogin() {
  if (!auth0Client) return;
  await auth0Client.loginWithRedirect({
    authorizationParams: {
      redirect_uri: window.location.origin + window.location.pathname,
      audience: AUTH0_AUDIENCE,
    },
  });
}

async function handleLogout() {
  if (!auth0Client) return;
  auth0Client.logout({
    logoutParams: {
      returnTo: window.location.origin + window.location.pathname,
    },
  });
}

// ========== API HELPER ==========

async function callApi(path, payload) {
  if (!API_BASE_URL) {
    throw new Error('API_BASE_URL is not configured in script.js');
  }

  const headers = {
    'Content-Type': 'application/json',
  };

  // Attach Auth0 token if we have one
  if (idToken) {
    headers['Authorization'] = `Bearer ${idToken}`;
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });

  let data;
  try {
    data = await response.json();
  } catch (err) {
    throw new Error(`Invalid JSON from API (status ${response.status})`);
  }

  if (!response.ok || data.ok === false) {
    const msg = (data && data.error) || `API error (status ${response.status})`;
    throw new Error(msg);
  }

  return data;
}

// ========== LOG HELPERS ==========

function loadLogFromStorage() {
  const stored = localStorage.getItem('calcLog');
  if (!stored) {
    logEntries = [];
    return;
  }
  try {
    const parsed = JSON.parse(stored);
    if (Array.isArray(parsed)) {
      logEntries = parsed;
    } else {
      logEntries = [];
    }
  } catch {
    logEntries = [];
  }
}

function saveLogToStorage() {
  try {
    localStorage.setItem('calcLog', JSON.stringify(logEntries));
  } catch (err) {
    console.error('Error saving log to localStorage:', err);
  }
}

function appendLogEntry(entry) {
  logEntries.unshift(entry);
  // Keep last 10
  logEntries = logEntries.slice(0, 10);
  saveLogToStorage();
}

function renderLog() {
  const pre = document.getElementById('logOutput');
  if (!pre) return;

  if (!logEntries.length) {
    pre.textContent = '(no entries yet)';
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
        '',
      ].join('\n');
    }

    if (entry.type === 'bottom') {
      return [
        `#${idx + 1} [BOTTOM] ${ts}`,
        `  Dist Weight (B13): ${entry.distWeight}`,
        `  Dist PF (B15):     ${entry.distPF}`,
        `  PG Conv (B16):     ${formatPgConv(entry.pgConv)}`,
        `  1st H2O (B17):     ${formatSecondH2O(entry.firstH2O)}`,
        '',
      ].join('\n');
    }

    if (entry.type === 'variable') {
      return [
        `#${idx + 1} [VARIABLE] ${ts}`,
        `  Weight:            ${entry.weight}`,
        `  Current Proof:     ${entry.proofCurrent}`,
        `  Target Proof:      ${entry.proofTarget}`,
        `  Curr PG Conv:      ${formatPgConv(entry.currentPgConv)}`,
        `  Target PG Conv:    ${formatPgConv(entry.targetPgConv)}`,
        `  Water to Add:      ${formatSecondH2O(entry.secondH2O)}`,
        `  New Weight:        ${formatNewWeight(entry.newWeight)}`,
        '',
      ].join('\n');
    }

    // Fallback for any older / unknown entries
    return `#${idx + 1} [UNKNOWN] ${ts}`;
  });

  pre.textContent = lines.join('\n');
}

// ========== CALCULATOR HANDLERS ==========

// Top: 2nd Round Water (Sheet2)
async function handleCalcTop() {
  const weightInput = document.getElementById('weightTop');
  const proofInput = document.getElementById('proofTop');
  const pgConvSpan = document.getElementById('pgConvTop');
  const secondH2OSpan = document.getElementById('secondH2O');
  const newWeightSpan = document.getElementById('newWeight');
  
  if (!weightInput || !proofInput || !pgConvSpan || !secondH2OSpan || !newWeightSpan) {
    alert('Top calculator elements not found.');
    return;
  }

  const weightStr = weightInput.value.trim();
  const proofStr = proofInput.value.trim(); // proof must stay as text (e.g. "80.136")
  
    if (!isValidThreeDecimalProof(proofStr)) {
  alert('Proof must have EXACTLY 3 decimal places (e.g. 80.620).');
  proofInput.focus();
  return;
}

  if (!weightStr || !proofStr) {
    alert('Please enter both Weight and Proof for the top calculator.');
    return;
  }
  
  const weight = Number(weightStr);
  if (!Number.isFinite(weight)) {
    alert('Weight (B2) must be a valid number.');
    return;
  }

  try {
    const result = await callApi('/calc/top', {
      weight,
      proof: proofStr,
    });

    // Worker returns: { ok, pgConv, secondH2O, newWeight }
    pgConvSpan.textContent = formatPgConv(result.pgConv);
    secondH2OSpan.textContent = formatSecondH2O(result.secondH2O);
    newWeightSpan.textContent = formatNewWeight(result.newWeight);

    appendLogEntry({
      type: 'top',
      timestamp: new Date().toISOString(),
      weightTop: weightStr,
      proofTop: proofStr,
      pgConv: formatPgConv(result.pgConv),
      secondH2O: formatSecondH2O(result.secondH2O),
      newWeight: formatNewWeight(result.newWeight),
    });

    renderLog();
  } catch (err) {
    console.error(err);
    alert(`Top calculation failed: ${err.message}`);
  }
}

// Bottom: 1st Water (Sheet2)
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
  const distPFStr = distPFInput.value.trim(); // user enters "90.5" as text

  if (!distWeightStr || !distPFStr) {
    alert('Please enter both Dist Weight and Dist PF for the bottom calculator.');
    return;
  }

  const distWeight = Number(distWeightStr);
  const distPF = Number(distPFStr);

  if (!Number.isFinite(distWeight)) {
    alert('Dist Weight (B13) must be a valid number.');
    return;
  }
  if (!Number.isFinite(distPF)) {
    alert('Dist PF (B15) must be a valid number with one decimal.');
    return;
  }

  try {
    const result = await callApi('/calc/bottom', {
      distWeight,
      distPF,
    });

    // Worker returns: { ok, pgConv, firstH2O }
    pgConvSpan.textContent = formatPgConv(result.pgConv);
    firstH2OSpan.textContent = String(result.firstH2O);

    appendLogEntry({
      type: 'bottom',
      timestamp: new Date().toISOString(),
      distWeight: distWeightStr,
      distPF: distPFStr,
      pgConv: formatPgConv(result.pgConv),
      firstH2O: String(result.firstH2O),
    });

    renderLog();
  } catch (err) {
    console.error(err);
    alert(`Bottom calculation failed: ${err.message}`);
  }
}

// ========== VARIABLE PROOF CALCULATOR ==========

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
    alert('Variable proof calculator elements not found in the DOM.');
    return;
  }
  
  const weightStr = weightInput.value.trim();
  const proofCurrentStr = proofCurrentInput.value.trim();
  const proofTargetStr = proofTargetInput.value.trim();

    if (!isValidThreeDecimalProof(proofCurrentStr)) {
  alert('Current Proof must have EXACTLY 3 decimal places (e.g. 177.726).');
  proofCurrentInput.focus();
  return;
}

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
      targetProof: proofTargetStr,
    });

    if (!result || result.ok === false) {
      const msg = result && result.error ? result.error : 'Unknown error.';
      throw new Error(msg);
    }

    // Backend returns:
    // { ok, currentPgConv, targetPgConv, secondH2O, newWeight }

    pgConvCurrentSpan.textContent = formatPgConv(result.currentPgConv);
    pgConvTargetSpan.textContent = formatPgConv(result.targetPgConv);
    h2OSpan.textContent = formatSecondH2O(result.secondH2O);
    newWeightSpan.textContent = formatNewWeight(result.newWeight);

    // Add to log
    appendLogEntry({
      type: 'variable',
      timestamp: new Date().toISOString(),
      weight: weightStr,
      proofCurrent: proofCurrentStr,
      proofTarget: proofTargetStr,
      currentPgConv: result.currentPgConv,
      targetPgConv: result.targetPgConv,
      secondH2O: result.secondH2O,
      newWeight: result.newWeight,
    });

    renderLog();
  } catch (err) {
    console.error(err);
    alert(`Variable proof calculation failed: ${err.message}`);
  }
}

// ========== INITIALIZATION ==========

function initTabs() {
  const btnTabTop = document.getElementById('btnTabTop');
  const btnTabVariable = document.getElementById('btnTabVariable');

  const panelTop = document.getElementById('panelTop');
  const panelVariable = document.getElementById('panelVariable');

  if (!btnTabTop || !btnTabVariable || !panelTop || !panelVariable) {
    console.warn('Tab elements not found; skipping tab init.');
    return;
  }

  function showPanel(name) {
    btnTabTop.classList.toggle('active', name === 'top');
    btnTabVariable.classList.toggle('active', name === 'variable');

    panelTop.style.display = name === 'top' ? 'block' : 'none';
    panelVariable.style.display = name === 'variable' ? 'block' : 'none';
  }

  btnTabTop.addEventListener('click', (e) => {
    e.preventDefault();
    showPanel('top');
  });

  btnTabVariable.addEventListener('click', (e) => {
    e.preventDefault();
    showPanel('variable');
  });

  // Default tab
  showPanel('top');
}

function initCalculatorUI() {
  // Load log from localStorage
  loadLogFromStorage();
  renderLog();

  // Wire up buttons
  const btnCalcTop = document.getElementById('btnCalcTop');
  const btnCalcBottom = document.getElementById('btnCalcBottom');
  const btnViewLog = document.getElementById('btnViewLog');
  const btnClearLog = document.getElementById('btnClearLog');
  const btnLogin = document.getElementById('btnLogin');
  const btnLogout = document.getElementById('btnLogout');
  const btnCalcVariable = document.getElementById('btnCalcVariable');

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

  // ⬇⬇ ADD THIS
  initTabs();
  
}

window.addEventListener('DOMContentLoaded', async () => {
  try {
    await initAuth0();
  } catch (err) {
    console.error('Error during Auth0 initialization:', err);
  }

  initCalculatorUI();
  await refreshAuthState();
});











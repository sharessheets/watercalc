// ========== AUTH0 CONFIG ==========
//
// 1) In Auth0 dashboard, copy:
//    - Domain  (e.g. "your-tenant.us.auth0.com")
//    - Client ID
// 2) Make sure these match your tenant.

const AUTH0_DOMAIN = 'dev-yncppqxbhx4m1lbd.us.auth0.com';
const AUTH0_CLIENT_ID = 'Ij2XpgNkCg7FBPXJYA7dCBiaKNO3qi4O';
// MUST match the API Identifier you create in Auth0 Dashboard → APIs
const AUTH0_AUDIENCE = 'https://proof-calc-api';

// ========== API CONFIG ==========
//
// Set this to your Cloudflare Worker URL.
// Example: "https://proof-calc.yourname.workers.dev"
// If you’ve bound a custom domain, use that instead.

const API_BASE_URL = 'https://proof-calc-worker.sharessheets.workers.dev'; // <-- TODO: set this

let auth0Client = null;
let idToken = null; // cached ID token (if authenticated)

// ========== LOG STATE ==========

let logEntries = [];

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

  if (isAuthenticated) {
    try {
      idToken = await auth0Client.getTokenSilently();
    } catch (err) {
      console.error('Error getting token silently:', err);
      idToken = null;
    }

    if (btnLogin) btnLogin.style.display = 'none';
    if (btnLogout) btnLogout.style.display = 'inline-block';
  } else {
    idToken = null;
    if (btnLogin) btnLogin.style.display = 'inline-block';
    if (btnLogout) btnLogout.style.display = 'none';
  }
}

async function handleLogin() {
  if (!auth0Client) return;
  await auth0Client.loginWithRedirect({
    authorizationParams: {
      redirect_uri: window.location.origin + window.location.pathname,
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
  if (!API_BASE_URL || API_BASE_URL.includes('YOUR-WORKER-URL-HERE')) {
    throw new Error('API_BASE_URL is not configured in script.js');
  }

  const headers = {
    'Content-Type': 'application/json',
  };

  // Attach Auth0 token if we have one (worker can choose to verify or ignore)
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
        `  PG Conv (B5):     ${entry.pgConv}`,
        `  2nd H2O (B6):     ${entry.secondH2O}`,
        `  2nd Weight (B8):  ${entry.newWeight}`,
        '',
      ].join('\n');
    } else if (entry.type === 'bottom') {
      return [
        `#${idx + 1} [BOTTOM] ${ts}`,
        `  Dist Weight (B13): ${entry.distWeight}`,
        `  Dist PF (B15):     ${entry.distPF}`,
        `  PG Conv (B16):     ${entry.pgConv}`,
        `  1st H2O (B17):     ${entry.firstH2O}`,
        '',
      ].join('\n');
    } else {
      return `#${idx + 1} [UNKNOWN] ${ts}`;
    }
  });

  pre.textContent = lines.join('\n');
}

function clearLog() {
  if (!confirm('Clear calculation log?')) return;
  logEntries = [];
  saveLogToStorage();
  renderLog();
}

// ========== CALCULATOR HANDLERS ==========

// Top: 2nd Round Water (Sheet2 B2, B4, etc.)
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
    // Send proof as TEXT (for LEFT()/RIGHT() behavior in worker) and also as "proof"
    const result = await callApi('/calc/top', {
      weight,
      proof: proofStr,
      proofText: proofStr,
    });

    // Expecting: { ok, pgConv, secondH2O, newWeight }
    pgConvSpan.textContent = String(result.pgConv);
    secondH2OSpan.textContent = String(result.secondH2O);
    newWeightSpan.textContent = String(result.newWeight);

    appendLogEntry({
      type: 'top',
      timestamp: new Date().toISOString(),
      weightTop: weightStr,
      proofTop: proofStr,
      pgConv: String(result.pgConv),
      secondH2O: String(result.secondH2O),
      newWeight: String(result.newWeight),
    });

    renderLog();
  } catch (err) {
    console.error(err);
    alert(`Top calculation failed: ${err.message}`);
  }
}

// Bottom: 1st Water (Sheet2 B13, B15, etc.)
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

    // Expecting: { ok, pgConv, firstH2O }
    pgConvSpan.textContent = String(result.pgConv);
    firstH2OSpan.textContent = String(result.firstH2O);

    appendLogEntry({
      type: 'bottom',
      timestamp: new Date().toISOString(),
      distWeight: distWeightStr,
      distPF: distPFStr,
      pgConv: String(result.pgConv),
      firstH2O: String(result.firstH2O),
    });

    renderLog();
  } catch (err) {
    console.error(e


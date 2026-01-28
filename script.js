// Global lookup table: proof (as string) -> PG
let proofToPg = [];
let logEntries = [];

// Single string representing the current "user state"
let activeUserCode = null;

// Allowed codes, managed via admin.html
let allowedUserCodes = [];

// ---------- INITIALIZATION ----------

window.addEventListener('DOMContentLoaded', () => {
  // Load proof table
  fetch('proof_table.json')
    .then(res => res.json())
    .then(data => {
      // data is an object mapping proof string -> PG
      proofToPg = data;
      console.log('Proof table loaded:', Object.keys(proofToPg).length, 'entries');
    })
    .catch(err => {
      console.error('Error loading proof_table.json:', err);
      alert('Error loading proof table. Check console.');
    });

  // Load log from localStorage
  const stored = localStorage.getItem('calcLog');
  if (stored) {
    try {
      logEntries = JSON.parse(stored);
    } catch {
      logEntries = [];
    }
  }

  // Load allowed codes
  loadAllowedCodes();

  // Load saved user code (if any)
  activeUserCode = localStorage.getItem('calcUserCode');
  if (activeUserCode && !isCodeAllowed(activeUserCode)) {
    // Previously set code is no longer allowed
    activeUserCode = null;
    localStorage.removeItem('calcUserCode');
  }
  updateUserCodeStatus();

  // Wire up calculator buttons
  document.getElementById('btnCalcTop').addEventListener('click', calculateTop);
  document.getElementById('btnCalcBottom').addEventListener('click', calculateBottom);
  document.getElementById('btnViewLog').addEventListener('click', renderLog);
  document.getElementById('btnClearLog').addEventListener('click', clearLogForCurrentCode);

  // Wire code button
  document.getElementById('btnSetUserCode').addEventListener('click', setUserCodeFromInput);

  renderLog();
});

// ---------- USER CODE HANDLING ----------

function loadAllowedCodes() {
  const raw = localStorage.getItem('allowedUserCodes');
  if (raw) {
    try {
      allowedUserCodes = JSON.parse(raw);
    } catch {
      allowedUserCodes = [];
    }
  } else {
    allowedUserCodes = [];
  }
}

function isCodeAllowed(code) {
  return allowedUserCodes.includes(code);
}

function setUserCodeFromInput() {
  const input = document.getElementById('userCodeInput');
  const code = input.value.trim();
  if (!code) {
    alert('Enter a code (e.g. bmoore).');
    return;
  }

  if (!isCodeAllowed(code)) {
    alert('Code not allowed. Contact the admin to be added.');
    return;
  }

  activeUserCode = code;
  localStorage.setItem('calcUserCode', activeUserCode);
  updateUserCodeStatus();
  renderLog();
}

function updateUserCodeStatus() {
  const statusSpan = document.getElementById('userCodeStatus');
  if (!statusSpan) return;

  if (activeUserCode) {
    statusSpan.textContent = `Active: ${activeUserCode}`;
    statusSpan.classList.remove('warning');
  } else {
    statusSpan.textContent = '(no active code set)';
    statusSpan.classList.add('warning');
  }
}

// ---------- TOP CALCULATOR (2nd ROUND WATER) ----------

function calculateTop() {
  if (!activeUserCode) {
    alert('Set an active code (e.g. bmoore) before calculating.');
    return;
  }

  const weightStr = document.getElementById('weightTop').value.trim();
  const proofStr = document.getElementById('proofTop').value.trim();

  const weight = parseFloat(weightStr);
  if (isNaN(weight)) {
    alert('Enter a valid Weight (B2).');
    return;
  }

  if (!hasExactDecimals(proofStr, 3)) {
    alert('Proof (B4) must have exactly 3 decimal places, e.g. 80.125');
    return;
  }

  const proofVal = parseFloat(proofStr);
  if (isNaN(proofVal)) {
    alert('Enter a valid Proof (B4).');
    return;
  }

  // Truncate to tenths (Excel LEFT(B4,4)*1 behavior)
  const proofTenth = Math.floor(proofVal * 10) / 10;
  const proofKey = Number(proofTenth.toFixed(1)).toString();
  const pgConv = proofToPg[proofKey];

  if (pgConv === undefined) {
    alert(`No PG Conv found for proof ${proofKey}.`);
    return;
  }

  // A9 = ((B2*B5)/0.10093) - B2
  const a9 = ((weight * pgConv) / 0.10093) - weight;

  // B6 = (A9/8.33) + (RIGHT(B4,2)*0.01*16)
  const decPart = proofStr.split('.')[1] || '';
  const lastTwoDigitsStr = decPart.slice(-2).padStart(2, '0');
  const lastTwoDigits = parseInt(lastTwoDigitsStr, 10) || 0;
  const secondH2O = (a9 / 8.33) + (lastTwoDigits * 0.01 * 16.0);

  // B8 = B2 + (B6*8.34)
  const newWeight = weight + (secondH2O * 8.34);

  document.getElementById('pgConvTop').textContent = formatNumber(pgConv, 5);
  document.getElementById('secondH2O').textContent = formatNumber(secondH2O, 3);
  document.getElementById('newWeight').textContent = formatNumber(newWeight, 2);

  // Log entry (Top)
  const entry = {
    timestamp: new Date().toISOString(),
    source: 'Top',
    userCode: activeUserCode,
    weight: weight,
    proof: proofStr,
    pgConvTop: pgConv,
    secondH2O: secondH2O,
    secondWeight: newWeight,
    distWeight: null,
    distPF: null,
    pgConvBottom: null,
    firstH2O: null
  };

  logEntries.push(entry);
  saveLog();
  renderLog();
  alert('Top calculation logged.');
}

// ---------- BOTTOM CALCULATOR (1st WATER) ----------

function calculateBottom() {
  if (!activeUserCode) {
    alert('Set an active code (e.g. bmoore) before calculating.');
    return;
  }

  const distWeightStr = document.getElementById('distWeight').value.trim();
  const distPfStr = document.getElementById('distPF').value.trim();

  const distWeight = parseFloat(distWeightStr);
  if (isNaN(distWeight)) {
    alert('Enter a valid Dist Weight (B13).');
    return;
  }

  if (!hasExactDecimals(distPfStr, 1)) {
    alert('Dist PF (B15) must have exactly 1 decimal place, e.g. 90.5');
    return;
  }

  const distPf = parseFloat(distPfStr);
  if (isNaN(distPf)) {
    alert('Enter a valid Dist PF (B15).');
    return;
  }

  const proofKey = Number(distPf.toFixed(1)).toString();
  const pgConv = proofToPg[proofKey];
  if (pgConv === undefined) {
    alert(`No PG Conv found for Dist PF ${proofKey}.`);
    return;
  }

  // A18 = ((B13*B16)/0.10093) - B13
  const a18 = ((distWeight * pgConv) / 0.10093) - distWeight;

  // B17 = (A18/8.33)
  const firstH2O = a18 / 8.33;

  document.getElementById('pgConvBottom').textContent = formatNumber(pgConv, 5);
  document.getElementById('firstH2O').textContent = formatNumber(firstH2O, 3);

  const entry = {
    timestamp: new Date().toISOString(),
    source: 'Bottom',
    userCode: activeUserCode,
    weight: null,
    proof: null,
    pgConvTop: null,
    secondH2O: null,
    secondWeight: null,
    distWeight: distWeight,
    distPF: distPfStr,
    pgConvBottom: pgConv,
    firstH2O: firstH2O
  };

  logEntries.push(entry);
  saveLog();
  renderLog();
  alert('Bottom calculation logged.');
}

// ---------- LOG HANDLING ----------

function saveLog() {
  localStorage.setItem('calcLog', JSON.stringify(logEntries));
}

function clearLogForCurrentCode() {
  if (!activeUserCode) {
    alert('Set an active code first.');
    return;
  }
  if (!confirm(`Clear all log entries for code "${activeUserCode}"?`)) return;

  logEntries = logEntries.filter(e => e.userCode !== activeUserCode);
  saveLog();
  renderLog();
}

function renderLog() {
  const out = document.getElementById('logOutput');
  if (!logEntries.length) {
    out.textContent = '(no entries yet)';
    return;
  }

  if (!activeUserCode) {
    out.textContent = '(set an active code to see entries)';
    return;
  }

  const visible = logEntries.filter(e => e.userCode === activeUserCode);

  if (!visible.length) {
    out.textContent = '(no entries yet for this code)';
    return;
  }

  const lines = visible.map(entry => {
    const ts = entry.timestamp.replace('T', ' ').split('.')[0];
    if (entry.source === 'Top') {
      return [
        `[${ts}] TOP (${entry.userCode})`,
        `  Weight: ${entry.weight}`,
        `  Proof: ${entry.proof}`,
        `  PG Conv: ${formatNumber(entry.pgConvTop, 5)}`,
        `  2nd H2O: ${formatNumber(entry.secondH2O, 3)}`,
        `  2nd Weight: ${formatNumber(entry.secondWeight, 2)}`,
        ''
      ].join('\n');
    } else {
      return [
        `[${ts}] BOTTOM (${entry.userCode})`,
        `  Dist Weight: ${entry.distWeight}`,
        `  Dist PF: ${entry.distPF}`,
        `  PG Conv: ${formatNumber(entry.pgConvBottom, 5)}`,
        `  1st H2O: ${formatNumber(entry.firstH2O, 3)}`,
        ''
      ].join('\n');
    }
  });

  out.textContent = lines.join('\n');
}

// ---------- HELPERS ----------

function hasExactDecimals(value, decimals) {
  if (!value.includes('.')) return false;
  const parts = value.split('.');
  return parts.length === 2 && parts[1].length === decimals;
}

function formatNumber(value, decimals) {
  return Number(value).toFixed(decimals);
}

// Global lookup table: proof (as string) -> PG
let proofToPg = {};
let logEntries = [];

// Load table & existing log on page load
window.addEventListener('DOMContentLoaded', () => {
  fetch('proof_table.json')
    .then(res => res.json())
    .then(data => {
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

  // Wire up buttons
  document.getElementById('btnCalcTop').addEventListener('click', calculateTop);
  document.getElementById('btnCalcBottom').addEventListener('click', calculateBottom);
  document.getElementById('btnViewLog').addEventListener('click', renderLog);
  document.getElementById('btnClearLog').addEventListener('click', clearLog);

  renderLog();
});

function calculateTop() {
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
  // Normalize key: 80.0 -> "80", 80.1 -> "80.1"
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

function calculateBottom() {
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

  // B16 = VLOOKUP(B15, Sheet1!A:C, 3, FALSE)
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

  // Log entry (Bottom)
  const entry = {
    timestamp: new Date().toISOString(),
    source: 'Bottom',
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

// Helpers
function hasExactDecimals(value, decimals) {
  if (!value.includes('.')) return false;
  const parts = value.split('.');
  return parts.length === 2 && parts[1].length === decimals;
}

function formatNumber(value, decimals) {
  return Number(value).toFixed(decimals);
}

function saveLog() {
  localStorage.setItem('calcLog', JSON.stringify(logEntries));
}

function clearLog() {
  if (!confirm('Clear all log entries?')) return;
  logEntries = [];
  saveLog();
  renderLog();
}

function renderLog() {
  const out = document.getElementById('logOutput');
  if (!logEntries.length) {
    out.textContent = '(no entries yet)';
    return;
  }

  const lines = logEntries.map(entry => {
    const ts = entry.timestamp.replace('T', ' ').split('.')[0];
    if (entry.source === 'Top') {
      return [
        `[${ts}] TOP`,
        `  Weight: ${entry.weight}`,
        `  Proof: ${entry.proof}`,
        `  PG Conv: ${formatNumber(entry.pgConvTop, 5)}`,
        `  2nd H2O: ${formatNumber(entry.secondH2O, 3)}`,
        `  2nd Weight: ${formatNumber(entry.secondWeight, 2)}`,
        ''
      ].join('\n');
    } else {
      return [
        `[${ts}] BOTTOM`,
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

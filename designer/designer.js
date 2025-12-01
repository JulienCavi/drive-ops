// ==================== STATE ====================
const state = {
  rows: 15,
  cols: 25,
  layout: {}, // { "MT00": {row: 0, col: 0}, ... }
  rayonMode: false,
  rayonCurrent: null,
  rayonPrefix: null,
  rayonNumber: null
};

// ==================== INIT ====================
document.addEventListener('DOMContentLoaded', () => {
  rebuildGrid();
  updateJSON();
  
  // Init inputs with state
  document.getElementById('rows-input').value = state.rows;
  document.getElementById('cols-input').value = state.cols;
});

// ==================== GRID LOGIC ====================
function rebuildGrid() {
  // Récupérer valeurs inputs
  state.rows = parseInt(document.getElementById('rows-input').value, 10);
  state.cols = parseInt(document.getElementById('cols-input').value, 10);
  
  const table = document.getElementById('plan-table');
  table.innerHTML = ''; // Clear
  
  for (let r = 0; r < state.rows; r++) {
    const tr = document.createElement('tr');
    for (let c = 0; c < state.cols; c++) {
      const td = document.createElement('td');
      
      // Chercher si meuble existe
      const meubleId = findMeubleAt(r, c);
      
      if (meubleId) {
        td.classList.add('filled');
        td.textContent = meubleId;
      }
      
      // Event
      td.onclick = () => onCellClick(r, c);
      tr.appendChild(td);
    }
    table.appendChild(tr);
  }
}

function findMeubleAt(row, col) {
  for (const [meubleId, pos] of Object.entries(state.layout)) {
    if (pos.row === row && pos.col === col) return meubleId;
  }
  return null;
}

function onCellClick(row, col) {
  if (state.rayonMode) {
    placeRayon(row, col);
  } else {
    editCellManual(row, col);
  }
}

function editCellManual(row, col) {
  const existing = findMeubleAt(row, col);
  const newCode = prompt(
    existing 
      ? `Modifier la case (${row}, ${col}) ?\n(Laisser vide pour effacer)`
      : `Ajouter un meuble en (${row}, ${col}) :`,
    existing || ''
  );
  
  if (newCode === null) return; // Cancel
  
  // Nettoyer l'ancien
  if (existing) delete state.layout[existing];
  
  // Ajouter le nouveau
  if (newCode.trim()) {
    state.layout[newCode.trim()] = { row, col };
  }
  
  rebuildGrid();
  updateJSON();
}

function clearAll() {
  if (confirm("Tout effacer ? Cette action est irréversible.")) {
    state.layout = {};
    rebuildGrid();
    updateJSON();
  }
}

// ==================== RAYON MODE ====================
function startRayonMode() {
  const input = document.getElementById('rayon-start');
  const val = input.value.trim().toUpperCase();
  
  if (!val) return alert("Code de départ requis (ex: MA01)");
  
  const match = val.match(/^([A-Z]{2})(\d+)$/);
  if (!match) return alert("Format invalide. Attendu : 2 lettres + chiffres (ex: MA01)");
  
  state.rayonMode = true;
  state.rayonPrefix = match[1];
  state.rayonNumber = parseInt(match[2], 10);
  state.rayonCurrent = val;
  
  updateRayonUI();
}

function stopRayonMode() {
  state.rayonMode = false;
  state.rayonCurrent = null;
  updateRayonUI();
}

function skipCurrent() {
  if (!state.rayonMode) return;
  
  // Incrémenter sans placer
  state.rayonNumber++;
  updateRayonTarget();
}

function placeRayon(row, col) {
  if (!state.rayonMode) return;
  
  const existing = findMeubleAt(row, col);
  if (existing) {
    // Protection écrasement
    if (!confirm(`Écraser ${existing} par ${state.rayonCurrent} ?`)) return;
    delete state.layout[existing];
  }
  
  // Placer
  state.layout[state.rayonCurrent] = { row, col };
  
  // Incrémenter
  state.rayonNumber++;
  updateRayonTarget();
  
  // Refresh
  rebuildGrid();
  updateJSON();
}

function updateRayonTarget() {
  // Formater le numéro avec padding 0 (ex: 1 -> "01", 10 -> "10")
  const numStr = String(state.rayonNumber).padStart(2, '0');
  state.rayonCurrent = state.rayonPrefix + numStr;
  updateRayonUI();
}

function updateRayonUI() {
  const badge = document.getElementById('rayon-badge');
  const controls = document.getElementById('rayon-controls');
  const startBtn = document.getElementById('btn-start-rayon');
  const targetDisplay = document.getElementById('target-display');
  
  if (state.rayonMode) {
    badge.textContent = "ON";
    badge.classList.add('active');
    controls.classList.remove('hidden');
    startBtn.classList.add('hidden');
    targetDisplay.textContent = state.rayonCurrent;
  } else {
    badge.textContent = "OFF";
    badge.classList.remove('active');
    controls.classList.add('hidden');
    startBtn.classList.remove('hidden');
  }
}

// ==================== JSON HANDLING ====================
function updateJSON() {
  const textarea = document.getElementById('json-output');
  textarea.value = JSON.stringify(state.layout, null, 2);
}

function copyJSON() {
  const textarea = document.getElementById('json-output');
  textarea.select();
  document.execCommand('copy');
  // Feedback visuel optionnel ici
}

function downloadJSON() {
  const data = JSON.stringify(state.layout, null, 2);
  const blob = new Blob([data], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  
  const a = document.createElement('a');
  a.href = url;
  a.download = "layout_export.json";
  a.click();
  URL.revokeObjectURL(url);
}

function importJSON(event) {
  const file = event.target.files[0];
  if (!file) return;
  
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const json = JSON.parse(e.target.result);
      
      // Basic validation
      if (typeof json !== 'object') throw new Error("JSON invalide");
      
      state.layout = json;
      
      // Auto-resize grid to fit data
      let maxR = 0, maxC = 0;
      Object.values(json).forEach(pos => {
        maxR = Math.max(maxR, pos.row);
        maxC = Math.max(maxC, pos.col);
      });
      
      if (maxR >= state.rows) state.rows = maxR + 5;
      if (maxC >= state.cols) state.cols = maxC + 5;
      
      document.getElementById('rows-input').value = state.rows;
      document.getElementById('cols-input').value = state.cols;
      
      rebuildGrid();
      updateJSON();
      alert("Layout chargé !");
      
    } catch (err) {
      alert("Erreur lecture JSON : " + err.message);
    }
  };
  reader.readAsText(file);
}

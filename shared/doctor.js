import {
  DOCTORS,
  getDoctorById,
  verifyDoctorPin,
  callNextPatient,
  completeConsultation,
  clearCompletedPatients,
  callEmergencyPatient,
  resolveEmergency,
  raiseEmergency,
  notifyEspCall,
  onQueueUpdate,
  initMqtt,
  getState,
  playChime,
  createToken,
  saveAndBroadcast
} from './api.js?v=18.0';

const appEl = document.getElementById('doctor-app');
const pinModalEl = document.getElementById('pin-modal');

let currentDoctorId = sessionStorage.getItem('triageq_active_doctor') || null;
let pendingDoctorId = null;
let enteredPin = '';
let pinError = '';
let activeTab = 'waiting'; // 'waiting' | 'completed'

// Secret Staff Simulation State
let secretStaffUnlocked = false;
let secretTapCount = 0;
let lastSecretTapTime = 0;

const DUMMY_PATIENT_PRESETS = [
  { name: 'Rahul Verma', age: 28, symptoms: ['General Checkup', 'Headache'], vitals: { temp: 98.4, spo2: 99, pulse: 72, isFever: false, isHypoxia: false } },
  { name: 'Sneha Patel', age: 34, symptoms: ['High Fever', 'Body Ache'], vitals: { temp: 101.4, spo2: 97, pulse: 92, isFever: true, isHypoxia: false } },
  { name: 'Vikram Malhotra', age: 46, symptoms: ['Cough', 'Throat Irritation'], vitals: { temp: 98.8, spo2: 98, pulse: 76, isFever: false, isHypoxia: false } },
  { name: 'Ananya Rao', age: 22, symptoms: ['Stomach Pain', 'Nausea'], vitals: { temp: 98.6, spo2: 99, pulse: 80, isFever: false, isHypoxia: false } },
  { name: 'Rohan Iyer', age: 31, symptoms: ['Cold & Flu', 'Sinus Pressure'], vitals: { temp: 99.2, spo2: 98, pulse: 74, isFever: false, isHypoxia: false } },
  { name: 'Kavita Reddy', age: 52, symptoms: ['Hypertension Review', 'Fatigue'], vitals: { temp: 98.5, spo2: 98, pulse: 84, isFever: false, isHypoxia: false } }
];
let dummyPresetIndex = 0;

async function addDummyPatient(type = 'routine') {
  if (!currentDoctorId) return;

  if (type === 'emergency') {
    await createToken({
      doctorId: currentDoctorId,
      name: 'Rajesh Kumar',
      age: 58,
      phone: '98' + Math.floor(10000000 + Math.random() * 90000000),
      symptoms: ['Chest Discomfort', 'Shortness of Breath', 'SOS Alert'],
      vitals: { temp: 99.6, spo2: 89, pulse: 114, isFever: false, isHypoxia: true },
      isEmergency: true,
      language: 'en'
    });
  } else if (type === 'fever') {
    await createToken({
      doctorId: currentDoctorId,
      name: 'Sneha Patel',
      age: 34,
      phone: '98' + Math.floor(10000000 + Math.random() * 90000000),
      symptoms: ['High Fever', 'Body Ache'],
      vitals: { temp: 101.4, spo2: 97, pulse: 92, isFever: true, isHypoxia: false },
      isEmergency: false,
      language: 'en'
    });
  } else {
    const p = DUMMY_PATIENT_PRESETS[dummyPresetIndex % DUMMY_PATIENT_PRESETS.length];
    dummyPresetIndex++;
    await createToken({
      doctorId: currentDoctorId,
      name: p.name,
      age: p.age,
      phone: '98' + Math.floor(10000000 + Math.random() * 90000000),
      symptoms: p.symptoms,
      vitals: p.vitals,
      isEmergency: false,
      language: 'en'
    });
  }

  playChime('chime');
  render();
}

async function addDummyBatch() {
  if (!currentDoctorId) return;
  for (let i = 0; i < 3; i++) {
    const p = DUMMY_PATIENT_PRESETS[(dummyPresetIndex + i) % DUMMY_PATIENT_PRESETS.length];
    await createToken({
      doctorId: currentDoctorId,
      name: p.name,
      age: p.age,
      phone: '98' + Math.floor(10000000 + Math.random() * 90000000),
      symptoms: p.symptoms,
      vitals: p.vitals,
      isEmergency: false,
      language: 'en'
    });
  }
  dummyPresetIndex += 3;
  playChime('chime');
  render();
}

function clearWaitingQueue() {
  if (!currentDoctorId) return;
  const s = getState();
  const doc = s.doctors[currentDoctorId];
  if (doc) {
    doc.queue = [];
    saveAndBroadcast(s);
    render();
  }
}

function render() {
  if (!currentDoctorId) {
    renderDoctorSelect();
  } else {
    renderDashboard();
  }
}

// --- 1. Doctor Selection Screen ---
function renderDoctorSelect() {
  const s = getState();
  const docCards = DOCTORS.map(doc => {
    const docData = s.doctors[doc.id] || { queue: [], serving: null, completed: [] };
    const waitingCount = docData.queue.length;
    const servingToken = docData.serving ? docData.serving.token : 'None';
    const emergencyWaiting = docData.queue.some(p => p.isEmergency);

    return `
      <div class="doctor-select-card" data-doc-id="${doc.id}">
        <div class="doc-card-header">
          <span class="doc-monogram-large">${doc.initials}</span>
          <div>
            <div class="doc-name-large">${doc.name}</div>
            <div class="doc-spec-badge">${doc.specialty.en}</div>
          </div>
        </div>
        <div class="doc-card-details">
          <div class="doc-detail-row">
            <span>Location:</span>
            <b>${doc.room}</b>
          </div>
          <div class="doc-detail-row">
            <span>Now Serving:</span>
            <b class="${docData.serving ? 'text-primary' : 'text-mut'}">${servingToken}</b>
          </div>
          <div class="doc-detail-row">
            <span>Waiting Patients:</span>
            <b>${waitingCount} patients</b>
          </div>
        </div>
        ${emergencyWaiting ? `<div class="doc-card-alert">[URGENT] Emergency Patient in Queue</div>` : ''}
        <button class="doc-login-btn">Log In to Console &rarr;</button>
        <div class="doc-pin-hint">Security PIN: <b>${doc.pin}</b></div>
      </div>
    `;
  }).join('');

  appEl.innerHTML = `
    <div class="doctor-login-wrapper">
      <div class="portal-header-bar">
        <div class="portal-brand">MediCore Clinic System</div>
        <a href="/" class="portal-chip">Kiosk Mode &rarr;</a>
      </div>
      <div class="doctor-select-container">
        <h1>Doctor Access Portal</h1>
        <p class="subtitle">Select physician profile and enter security PIN to access live consultations.</p>
        <div class="doctor-cards-grid">
          ${docCards}
        </div>
      </div>
    </div>
  `;
}

// --- 2. PIN Verification Modal ---
function showPinModal(docId) {
  pendingDoctorId = docId;
  enteredPin = '';
  pinError = '';
  renderPinModal();
}

function renderPinModal() {
  if (!pendingDoctorId) {
    pinModalEl.className = '';
    pinModalEl.innerHTML = '';
    return;
  }

  const doc = DOCTORS.find(d => d.id === pendingDoctorId);
  const pinSlots = [0, 1, 2, 3].map(i => {
    return `<span class="pin-digit-slot ${enteredPin.length > i ? 'filled' : ''}">${enteredPin.length > i ? '&bull;' : ''}</span>`;
  }).join('');

  pinModalEl.className = 'on';
  pinModalEl.innerHTML = `
    <div class="pin-modal-card">
      <div class="pin-modal-header">
        <span class="doc-monogram-medium">${doc.initials}</span>
        <div>
          <h3>${doc.name}</h3>
          <p>${doc.room} &bull; ${doc.specialty.en}</p>
        </div>
      </div>
      
      <p style="margin: 1.5vmin 0 0.5vmin; font-weight: 600;">Enter 4-Digit Security PIN</p>
      <div class="pin-slots-wrapper">${pinSlots}</div>
      ${pinError ? `<div class="pin-error-msg">${pinError}</div>` : ''}
      
      <div class="pad pin-pad">
        ${[1, 2, 3, 4, 5, 6, 7, 8, 9, 'C', 0, '⌫'].map(k => `<button data-pin-k="${k}">${k}</button>`).join('')}
      </div>

      <div class="row" style="margin-top: 2vmin; width: 100%;">
        <button class="alt" style="flex: 1; min-height: 50px;" id="pin-cancel-btn">Cancel</button>
      </div>

      <div class="pin-hint-text">Security PIN for ${doc.name}: <b>${doc.pin}</b></div>
    </div>
  `;
}

// --- 3. Doctor Dashboard Workspace ---
function renderDashboard() {
  const doc = getDoctorById(currentDoctorId);
  if (!doc) {
    currentDoctorId = null;
    sessionStorage.removeItem('triageq_active_doctor');
    renderDoctorSelect();
    return;
  }

  const s = getState();
  const queue = doc.queue || [];
  const serving = doc.serving || null;
  const completed = doc.completed || [];
  const emergencyPatient = queue.find(p => p.isEmergency);
  const isAlarmRinging = s.emergency;

  // Header & Status
  const headerHtml = `
    <header class="doc-dash-header">
      <div class="doc-header-left">
        <span class="doc-monogram-header" id="btn-secret-tap" style="cursor:pointer; user-select:none;" title="Click 3 times for Simulation Menu">${doc.initials}</span>
        <div>
          <h2 class="doc-header-name">${doc.name}</h2>
          <div class="doc-header-meta">
            <span class="badge room">${doc.room}</span>
            <span class="badge spec">${doc.specialty.en}</span>
            <span class="badge active-status">&bull; Online &amp; Consulting</span>
          </div>
        </div>
      </div>
      <div class="doc-header-actions">
        <button class="btn-silence-alarm ${isAlarmRinging ? 'ringing' : 'idle'}" id="btn-silence-esp" title="Mute or silence the ESP32 hardware siren">
          ${isAlarmRinging ? 'STOP EMERGENCY SIREN' : 'Mute Buzzer'}
        </button>
        <a href="/" class="portal-chip">Kiosk Mode &rarr;</a>
        <button class="doc-switch-btn" id="btn-switch-doctor">Switch Doctor</button>
      </div>
    </header>
  `;

  // Secret Staff Simulation Panel
  const secretPanelHtml = secretStaffUnlocked ? `
    <div class="doc-secret-panel">
      <div class="doc-secret-header">
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
          <span class="doc-secret-badge">[SIMULATION CONTROLS]</span>
          <span class="doc-secret-sub">Hidden Staff Test Suite &bull; Toggle via 3-clicks on avatar or [ \` ]</span>
        </div>
        <button class="doc-secret-close-btn" id="btn-close-secret-panel">&times; Lock / Close</button>
      </div>
      <div class="doc-secret-actions">
        <button class="doc-secret-btn" id="btn-add-dummy-routine">
          + Add Routine Patient (Checkup)
        </button>
        <button class="doc-secret-btn" id="btn-add-dummy-fever">
          + Add Fever Patient (101.4 °F)
        </button>
        <button class="doc-secret-btn doc-secret-btn-danger" id="btn-add-dummy-emergency">
          + Add Emergency SOS Patient (Low O2)
        </button>
        <button class="doc-secret-btn" id="btn-add-dummy-batch">
          + Add 3 Queued Patients
        </button>
        <button class="doc-secret-btn doc-secret-btn-alt" id="btn-clear-waiting-queue">
          Clear Waiting Queue
        </button>
      </div>
    </div>
  ` : '';

  // Stats Bar
  const statsHtml = `
    <div class="doc-stats-grid">
      <div class="stat-card">
        <div class="stat-num">${queue.length}</div>
        <div class="stat-label">Patients Waiting</div>
      </div>
      <div class="stat-card">
        <div class="stat-num">~${queue.length * 5} <small>min</small></div>
        <div class="stat-label">Estimated Queue Wait</div>
      </div>
      <div class="stat-card">
        <div class="stat-num">${completed.length}</div>
        <div class="stat-label">Consultations Finished Today</div>
      </div>
      <div class="stat-card ${emergencyPatient ? 'stat-card-danger' : ''}">
        <div class="stat-num">${emergencyPatient ? '1 Priority' : '0'}</div>
        <div class="stat-label">Emergency Patients</div>
      </div>
    </div>
  `;

  // Emergency Banner
  const emergencyBannerHtml = (isAlarmRinging || emergencyPatient) ? `
    <div class="emergency-alert-banner">
      <div class="emergency-alert-info">
        <div class="emergency-badge-tag">CRITICAL ALERT</div>
        <div>
          <div class="emergency-title">EMERGENCY ALARM ACTIVE</div>
          <div class="emergency-desc">
            ${emergencyPatient ? `Patient: <b>${emergencyPatient.name}</b> (Token: <b>${emergencyPatient.token}</b>, Age: ${emergencyPatient.age}) &bull; Symptoms: <b>${emergencyPatient.symptoms.join(', ')}</b>` : 'Emergency SOS triggered at Kiosk or Patient Mobile Tracker. Immediate staff attention required.'}
          </div>
        </div>
      </div>
      <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;">
        <button class="btn-silence-alarm" id="btn-silence-banner" style="min-height:48px;padding:0 22px;font-size:0.95em;font-weight:800;letter-spacing:0.04em;">
          STOP / SILENCE BUZZER
        </button>
        ${emergencyPatient ? `
          <button class="btn-call-emergency" data-call-emergency="${emergencyPatient.token}">
            Call Emergency Patient Now
          </button>
        ` : ''}
      </div>
    </div>
  ` : '';

  // Active Consultation Panel
  let servingPanelHtml = '';
  if (serving) {
    const elapsedMinutes = Math.floor((Date.now() - (serving.calledAt || serving.createdAt)) / 60000);
    servingPanelHtml = `
      <div class="serving-card ${serving.isEmergency ? 'serving-emergency' : ''}">
        <div class="serving-card-badge">Currently In Consultation</div>
        <div class="serving-token">${serving.token}</div>
        <div class="serving-patient-name">${serving.name}</div>
        <div class="serving-patient-meta">
          <span>Age: <b>${serving.age} yrs</b></span> &bull; 
          ${serving.phone ? `<span>Phone: <b>+91 ${serving.phone}</b></span> &bull; ` : ''}
          <span>In Room: <b>${elapsedMinutes}m ago</b></span>
        </div>
        <div class="serving-symptoms-chips">
          ${serving.symptoms.map(s => `<span class="chip-sym">${s}</span>`).join('')}
          ${serving.isEmergency ? `<span class="chip-sym chip-danger">CRITICAL</span>` : ''}
        </div>

        ${serving.vitals ? `
          <div class="doc-vitals-badge ${serving.vitals.isFever ? 'doc-vitals-fever' : serving.vitals.isHypoxia ? 'doc-vitals-hypoxia' : ''}">
            <div class="doc-vitals-item"><b>Temp:</b> <span>${serving.vitals.temp} °F</span></div>
            &bull;
            <div class="doc-vitals-item"><b>SpO2:</b> <span>${serving.vitals.spo2 !== null && serving.vitals.spo2 !== undefined ? serving.vitals.spo2 + '%' : '--'}</span></div>
            &bull;
            <div class="doc-vitals-item"><b>Pulse:</b> <span>${serving.vitals.pulse !== null && serving.vitals.pulse !== undefined ? serving.vitals.pulse + ' bpm' : '--'}</span></div>
            ${serving.vitals.isFever ? `<span class="chip-sym chip-danger" style="margin-left:6px;">FEVER FLAG</span>` : ''}
            ${serving.vitals.isHypoxia ? `<span class="chip-sym chip-danger" style="margin-left:6px; background:#fffbeb; color:#92400e; border:1px solid #fbbf24;">LOW O2</span>` : ''}
          </div>
        ` : ''}

        <div class="serving-action-row">
          <button class="btn-complete-consultation" id="btn-complete-consult">
            Complete Consultation
          </button>
          <button class="btn-call-next" id="btn-next-patient">
            Call Next Patient
          </button>
          <button class="alt btn-recall" id="btn-recall-patient" title="Chime tone and re-announce token">
            Announce Again
          </button>
        </div>
      </div>
    `;
  } else {
    servingPanelHtml = `
      <div class="serving-card serving-empty">
        <div class="empty-icon"><span class="clinical-icon-cross">+</span></div>
        <h3>Room Available &bull; ${doc.room}</h3>
        <p class="text-mut">
          ${queue.length > 0 
            ? `${queue.length} patient(s) waiting in queue. Ready for next consultation.`
            : 'No patients waiting in queue. Kiosk registrations will appear here automatically.'}
        </p>
        <button class="btn-call-next large" id="btn-next-patient" ${queue.length === 0 ? 'disabled' : ''}>
          Call Next Patient ${queue.length > 0 ? `(${queue[0].token})` : ''}
        </button>
      </div>
    `;
  }

  // Queue Tabs & Content
  let queueContentHtml = '';
  if (activeTab === 'waiting') {
    if (queue.length === 0) {
      queueContentHtml = `
        <div class="empty-list-notice">
          <p style="font-weight:700;font-size:1.1em;">Queue is currently clear.</p>
          <small class="text-mut">Patient tokens issued at the kiosk will appear here automatically.</small>
        </div>
      `;
    } else {
      const rows = queue.map((p, idx) => {
        const waitMins = Math.max(1, Math.round((Date.now() - p.createdAt) / 60000));
        return `
          <div class="queue-row ${p.isEmergency ? 'queue-row-emergency' : ''}">
            <div class="queue-pos-badge ${p.isEmergency ? 'pos-emergency' : ''}">
              ${p.isEmergency ? 'EMG' : `#${idx + 1}`}
            </div>
            <div class="queue-patient-info">
              <div class="queue-token-name">
                <span class="queue-token">${p.token}</span>
                <span class="queue-name">${p.name}</span>
                ${p.isEmergency ? `<span class="badge-danger">CRITICAL PRIORITY</span>` : ''}
              </div>
              <div class="queue-sub-meta">
                <span>Age: ${p.age}</span> &bull;
                ${p.vitals ? `<span><b>${p.vitals.temp !== null && p.vitals.temp !== undefined ? p.vitals.temp + '°F' : '--°F'}</b> &bull; <b>${p.vitals.spo2 !== null && p.vitals.spo2 !== undefined ? p.vitals.spo2 + '% O2' : '--% O2'}</b></span> &bull; ` : ''}
                ${p.phone ? `<span>+91 ${p.phone}</span> &bull; ` : ''}
                <span>Symptoms: <b>${p.symptoms.join(', ') || 'General Checkup'}</b></span>
              </div>
            </div>
            <div class="queue-time-col">
              <span class="queue-wait-time">${waitMins} min wait</span>
            </div>
            <div class="queue-action-col">
              ${p.isEmergency 
                ? `<button class="btn-row-action emergency" data-call-emergency="${p.token}">Call Emergency</button>`
                : `<button class="btn-row-action" data-call-token="${p.token}">Call Patient</button>`}
            </div>
          </div>
        `;
      }).join('');
      queueContentHtml = `<div class="queue-list-container">${rows}</div>`;
    }
  } else {
    // Completed tab
    if (completed.length === 0) {
      queueContentHtml = `
        <div class="empty-list-notice">
          <p style="font-weight:700;">No completed consultations recorded yet today.</p>
        </div>
      `;
    } else {
      const rows = completed.map(p => {
        const timeStr = p.completedAt ? new Date(p.completedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Earlier';
        return `
          <div class="queue-row completed-row">
            <div class="queue-pos-badge completed-badge">&#10003;</div>
            <div class="queue-patient-info">
              <div class="queue-token-name">
                <span class="queue-token">${p.token}</span>
                <span class="queue-name">${p.name}</span>
              </div>
              <div class="queue-sub-meta">
                <span>Age: ${p.age}</span> &bull;
                ${p.phone ? `<span>+91 ${p.phone}</span> &bull; ` : ''}
                <span>Symptoms: ${p.symptoms.join(', ')}</span>
              </div>
            </div>
            <div class="queue-time-col">
              <span class="badge room">Finished at ${timeStr}</span>
            </div>
          </div>
        `;
      }).join('');
      queueContentHtml = `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:12px 20px;border-bottom:1px solid var(--border);background:#f8fafc;">
          <span style="font-size:0.85em;color:var(--sub);font-weight:700;">Completed Consultations: <b>${completed.length}</b></span>
          <button id="btn-clear-completed" class="alt" style="min-height:36px;padding:0 14px;font-size:0.8em;border-radius:8px;font-weight:700;" title="Clear completed patient history for today">
            Clear Completed Patients
          </button>
        </div>
        <div class="queue-list-container">${rows}</div>
      `;
    }
  }

  appEl.innerHTML = `
    <div class="doctor-dashboard-wrapper">
      ${headerHtml}
      <div class="doc-content-container">
        ${secretPanelHtml}
        ${emergencyBannerHtml}
        ${statsHtml}
        
        <div class="doc-main-grid">
          <!-- Left Column: Current Patient -->
          <div class="grid-left-col">
            ${servingPanelHtml}
          </div>

          <!-- Right Column: Queue & Completed -->
          <div class="grid-right-col">
            <div class="queue-panel-card">
              <div class="queue-tabs-header">
                <button class="queue-tab-btn ${activeTab === 'waiting' ? 'active' : ''}" data-tab="waiting">
                  Waiting Queue (${queue.length})
                </button>
                <button class="queue-tab-btn ${activeTab === 'completed' ? 'active' : ''}" data-tab="completed">
                  Completed Today (${completed.length})
                </button>
              </div>
              ${queueContentHtml}
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
}

// --- Event Listeners ---

// Global click delegation
document.addEventListener('click', e => {
  // Doctor Select Card click
  const selectCard = e.target.closest('[data-doc-id]');
  if (selectCard) {
    const docId = selectCard.dataset.docId;
    showPinModal(docId);
    return;
  }

  // Cancel PIN modal
  if (e.target.closest('#pin-cancel-btn')) {
    pendingDoctorId = null;
    enteredPin = '';
    pinModalEl.className = '';
    return;
  }

  // PIN numpad keys
  const pinKey = e.target.closest('[data-pin-k]');
  if (pinKey) {
    const k = pinKey.dataset.pinK;
    if (k === 'C') {
      enteredPin = '';
    } else if (k === '⌫') {
      enteredPin = enteredPin.slice(0, -1);
    } else if (enteredPin.length < 4) {
      enteredPin += k;
    }
    pinError = '';
    renderPinModal();

    if (enteredPin.length === 4) {
      if (verifyDoctorPin(pendingDoctorId, enteredPin)) {
        currentDoctorId = pendingDoctorId;
        sessionStorage.setItem('triageq_active_doctor', currentDoctorId);
        pendingDoctorId = null;
        enteredPin = '';
        pinModalEl.className = '';
        render();
      } else {
        pinError = 'Incorrect PIN. Please try again.';
        enteredPin = '';
        renderPinModal();
      }
    }
    return;
  }

  // Switch Doctor / Logout
  if (e.target.closest('#btn-switch-doctor')) {
    currentDoctorId = null;
    sessionStorage.removeItem('triageq_active_doctor');
    render();
    return;
  }

  // Silence ESP32 buzzer
  if (e.target.closest('#btn-silence-esp') || e.target.closest('#btn-silence-banner')) {
    resolveEmergency({ kioskId: 'K1' });
    render();
    return;
  }

  // Clear Completed Patients History
  if (e.target.closest('#btn-clear-completed')) {
    if (confirm('Clear the completed patient consultations history for today?')) {
      clearCompletedPatients(currentDoctorId);
      render();
    }
    return;
  }

  // Complete Consultation
  if (e.target.closest('#btn-complete-consult')) {
    completeConsultation(currentDoctorId);
    playChime('chime');
    render();
    return;
  }

  // Call Next Patient
  if (e.target.closest('#btn-next-patient')) {
    callNextPatient(currentDoctorId);
    playChime('chime');
    render();
    return;
  }

  // Re-call patient
  if (e.target.closest('#btn-recall-patient')) {
    const s = getState();
    const docData = s?.doctors?.[currentDoctorId];
    const docMeta = getDoctorById(currentDoctorId);
    if (docData?.serving) {
      notifyEspCall({
        doctorId: currentDoctorId,
        doctorName: docMeta ? docMeta.name : 'Doctor',
        room: docMeta ? docMeta.room : 'Room 101',
        token: docData.serving.token,
        patientName: docData.serving.name,
        isEmergency: docData.serving.isEmergency || false
      });
    }
    playChime('chime');
    return;
  }

  // Call Emergency Patient button
  const emergBtn = e.target.closest('[data-call-emergency]');
  if (emergBtn) {
    const token = emergBtn.dataset.callEmergency;
    callEmergencyPatient(currentDoctorId, token);
    playChime('chime');
    render();
    return;
  }

  // Call specific patient from queue row
  const callTokenBtn = e.target.closest('[data-call-token]');
  if (callTokenBtn) {
    const token = callTokenBtn.dataset.callToken;
    callEmergencyPatient(currentDoctorId, token);
    playChime('chime');
    render();
    return;
  }

  // Switch Queue Tab
  const tabBtn = e.target.closest('[data-tab]');
  if (tabBtn) {
    activeTab = tabBtn.dataset.tab;
    render();
    return;
  }

  // Secret Tap on doctor avatar to unlock simulation controls
  if (e.target.closest('#btn-secret-tap')) {
    const now = Date.now();
    if (now - lastSecretTapTime < 1400) {
      secretTapCount++;
    } else {
      secretTapCount = 1;
    }
    lastSecretTapTime = now;
    if (secretTapCount >= 3) {
      secretStaffUnlocked = !secretStaffUnlocked;
      secretTapCount = 0;
      playChime('chime');
    }
    render();
    return;
  }

  // Close secret panel
  if (e.target.closest('#btn-close-secret-panel')) {
    secretStaffUnlocked = false;
    render();
    return;
  }

  // Add dummy routine patient
  if (e.target.closest('#btn-add-dummy-routine')) {
    addDummyPatient('routine');
    return;
  }

  // Add dummy fever patient
  if (e.target.closest('#btn-add-dummy-fever')) {
    addDummyPatient('fever');
    return;
  }

  // Add dummy emergency patient
  if (e.target.closest('#btn-add-dummy-emergency')) {
    addDummyPatient('emergency');
    return;
  }

  // Add dummy 3-patient batch
  if (e.target.closest('#btn-add-dummy-batch')) {
    addDummyBatch();
    return;
  }

  // Clear waiting queue
  if (e.target.closest('#btn-clear-waiting-queue')) {
    clearWaitingQueue();
    return;
  }
});

// Keyboard support for simulation controls and PIN entry
window.addEventListener('keydown', e => {
  // Secret staff simulation shortcut (Backtick ` or Tilde ~)
  if (e.key === '`' || e.key === '~') {
    if (currentDoctorId) {
      e.preventDefault();
      secretStaffUnlocked = !secretStaffUnlocked;
      playChime('chime');
      render();
      return;
    }
  }

  if (!pendingDoctorId) return;

  if (e.key >= '0' && e.key <= '9') {
    if (enteredPin.length < 4) {
      enteredPin += e.key;
      pinError = '';
      renderPinModal();
      if (enteredPin.length === 4) {
        if (verifyDoctorPin(pendingDoctorId, enteredPin)) {
          currentDoctorId = pendingDoctorId;
          sessionStorage.setItem('triageq_active_doctor', currentDoctorId);
          pendingDoctorId = null;
          enteredPin = '';
          pinModalEl.className = '';
          render();
        } else {
          pinError = 'Incorrect PIN. Please try again.';
          enteredPin = '';
          renderPinModal();
        }
      }
    }
  } else if (e.key === 'Backspace') {
    enteredPin = enteredPin.slice(0, -1);
    pinError = '';
    renderPinModal();
  } else if (e.key === 'Escape') {
    pendingDoctorId = null;
    enteredPin = '';
    pinModalEl.className = '';
  }
});

// Real-time synchronization
initMqtt();
onQueueUpdate(() => {
  render();
});

// Timer tick every 10 seconds to update wait minutes
setInterval(() => {
  if (currentDoctorId) {
    render();
  }
}, 10000);

// Initial start
render();


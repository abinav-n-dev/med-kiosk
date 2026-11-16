import {
  getPatientToken,
  getDoctorById,
  raiseEmergency,
  resolveEmergency,
  onQueueUpdate,
  initMqtt,
  playChime,
  playTestBeep,
  getAudioContext
} from './api.js?v=18.0';

const appEl = document.getElementById('patient-app');
const sosModalEl = document.getElementById('patient-sos-modal');

// --- Multilingual Dictionary (English & Hindi) ---
const TP = {
  en: {
    portalBrand: 'MediCore Clinic',
    liveTracker: 'Live Patient Queue Tracker',
    live: 'LIVE',
    connecting: 'CONNECTING',
    syncing: 'Connecting to Live Queue',
    syncingDesc: 'Syncing with hospital servers for Token:',
    trackTurn: 'Track Your Queue Turn',
    enterTokenDesc: 'Enter the token number from your kiosk slip (e.g. GS-001 or PS-001).',
    trackBtn: 'Track Live Queue ->',
    scanHint: 'You can also scan the QR code printed on the Kiosk screen to open this automatically.',
    notFoundTitle: 'Token Not Found',
    notFoundDesc: 'Could not find token:',
    notFoundHint: 'Please make sure the token was registered on the kiosk today.',
    enterAnother: 'Enter Another Token',
    yourToken: 'YOUR TOKEN',
    critPriority: 'CRITICAL / EMERGENCY PRIORITY',
    patientName: 'Patient Name',
    ageYrs: 'yrs',
    assignedDoc: 'Assigned Doctor',
    room: 'Consultation Room',
    symptoms: 'Symptoms',
    routine: 'Routine Checkup',
    yourTurn: 'YOUR TURN',
    proceedTo: 'Please Proceed to',
    docReady: 'is ready for your consultation now.',
    waitingInQueue: 'Waiting in Queue',
    nextInLine: 'You are Next in Line',
    aheadCount: (n) => `${n} patient(s) ahead of you`,
    estWait: 'Estimated wait:',
    mins: 'mins',
    waitingHint: 'Please wait in the clinic hall. This page will sound a chime and vibrate when your token is called.',
    completedTitle: 'Consultation Completed',
    thankYou: 'Thank You,',
    completedDesc: 'Your consultation has concluded. Collect your prescription at the pharmacy desk.',
    completedFoot: 'Thank you. Consultation concluded.',
    sosPrompt: 'Feeling severely unwell or experiencing chest pain?',
    sosBtn: 'EMERGENCY ASSISTANCE: Alert Staff',
    trackDiff: 'Track Different Token',
    docOnBreakBanner: (doc) => `${doc} is taking a brief 5-min hydration pause. Queue will resume shortly.`,
    vitalsTitle: 'Recorded Vitals',
    soundBannerIdle: 'Turn Alert: Tap here to enable chime & vibration',
    soundBannerActive: 'Turn Alert Active: Chime & vibration ready',
    replayAlert: 'Replay Turn Announcement',
    sosModalTitle: 'Call Emergency Staff?',
    sosModalDesc: (doc) => `This will immediately activate the clinic alarm and notify ${doc} to attend to you urgently.`,
    confirmSos: 'Confirm Emergency Alert',
    cancel: 'Cancel',
    sosSentTitle: 'Emergency Alert Sent',
    sosSentDesc: 'Medical staff and doctor have been notified. Please remain seated; assistance is arriving immediately.',
    acknowledge: 'Acknowledge',
    speech: (tok, room, doc) => `Token ${tok}. Please proceed to ${room}, ${doc}.`,
    symptomMap: {
      'Fever': 'Fever',
      'Cough': 'Cough',
      'Chest pain': 'Chest pain (Urgent)',
      'Injury': 'Injury',
      'Child unwell': 'Child unwell',
      'Other': 'Other',
      'SOS Alert': 'SOS Alert'
    }
  },
  hi: {
    portalBrand: 'मेडीकोर क्लिनिक',
    liveTracker: 'लाइव मरीज़ कतार ट्रैकर',
    live: 'लाइव',
    connecting: 'कनेक्ट हो रहा है',
    syncing: 'लाइव कतार से जुड़ रहे हैं',
    syncingDesc: 'अस्पताल सर्वर से टोकन प्राप्त किया जा रहा है:',
    trackTurn: 'अपनी बारी ट्रैक करें',
    enterTokenDesc: 'अपनी कियोस्क पर्ची से टोकन नंबर दर्ज करें (जैसे GS-001 या PS-001)।',
    trackBtn: 'लाइव कतार देखें ->',
    scanHint: 'आप कियोस्क स्क्रीन पर दिया गया QR कोड स्कैन करके भी इसे सीधे खोल सकते हैं।',
    notFoundTitle: 'टोकन नहीं मिला',
    notFoundDesc: 'यह टोकन नहीं मिला:',
    notFoundHint: 'कृपया सुनिश्चित करें कि टोकन आज कियोस्क पर पंजीकृत किया गया था।',
    enterAnother: 'दूसरा टोकन दर्ज करें',
    yourToken: 'आपका टोकन',
    critPriority: 'आपातकालीन / गंभीर प्राथमिकता',
    patientName: 'मरीज़ का नाम',
    ageYrs: 'वर्ष',
    assignedDoc: 'संबंधित डॉक्टर',
    room: 'परामर्श कक्ष',
    symptoms: 'लक्षण / समस्या',
    routine: 'सामान्य जाँच',
    yourTurn: 'आपकी बारी',
    proceedTo: 'कृपया पधारें:',
    docReady: 'अब आपके परामर्श के लिए तैयार हैं।',
    waitingInQueue: 'कतार में प्रतीक्षा',
    nextInLine: 'आपकी बारी अगली है',
    aheadCount: (n) => `आपसे आगे ${n} मरीज़ हैं`,
    estWait: 'अनुमानित प्रतीक्षा:',
    mins: 'मिनट',
    waitingHint: 'कृपया प्रतीक्षालय में बैठें। आपकी बारी आने पर यह पेज घंटी और कंपन से सूचित करेगा।',
    completedTitle: 'परामर्श संपन्न',
    thankYou: 'धन्यवाद,',
    completedDesc: 'आपका परामर्श पूर्ण हो चुका है। फार्मेसी काउंटर से अपनी दवाइयाँ प्राप्त करें।',
    completedFoot: 'धन्यवाद। परामर्श समाप्त।',
    sosPrompt: 'क्या आपकी तबीयत अचानक बिगड़ रही है या सीने में दर्द है?',
    sosBtn: 'आपातकालीन सहायता: तुरंत स्टाफ बुलाएँ',
    trackDiff: 'दूसरा टोकन ट्रैक करें',
    docOnBreakBanner: (doc) => `${doc} कुछ देर (लगभग 5 मिनट) जलपान व स्वच्छता विराम पर हैं। कतार शीघ्र पुनः शुरू होगी।`,
    vitalsTitle: 'स्वास्थ्य माप',
    soundBannerIdle: 'अलर्ट घंटी: बारी आने पर आवाज़ व कंपन के लिए यहाँ टैप करें',
    soundBannerActive: 'अलर्ट सक्रिय: बारी आने पर घंटी व कंपन होगा',
    replayAlert: 'घंटी व घोषणा दोबारा सुनें',
    sosModalTitle: 'आपातकालीन स्टाफ को बुलाएँ?',
    sosModalDesc: (doc) => `यह तुरंत क्लिनिक का अलार्म बजा देगा और ${doc} को तत्काल उपस्थित होने की सूचना देगा।`,
    confirmSos: 'आपातकाल की पुष्टि करें',
    cancel: 'रद्द करें',
    sosSentTitle: 'आपातकालीन सूचना भेज दी गई है',
    sosSentDesc: 'मेडिकल स्टाफ और डॉक्टर को सूचित कर दिया गया है। कृपया बैठे रहें; सहायता तुरंत पहुँच रही है।',
    acknowledge: 'ठीक है / समझ गया',
    speech: (tok, room, doc) => `टोकन ${tok}। कृपया ${room}, डॉक्टर ${doc} के पास पधारें।`,
    symptomMap: {
      'Fever': 'बुखार',
      'Cough': 'खाँसी',
      'Chest pain': 'सीने में दर्द (आपातकाल)',
      'Injury': 'चोट',
      'Child unwell': 'बच्चा बीमार',
      'Other': 'अन्य',
      'SOS Alert': 'आपातकालीन सहायता (SOS)'
    }
  }
};

function formatDoctorName(name, lang) {
  if (lang === 'hi') {
    if (name.includes('Gaurav')) return 'डॉ. गौरव शर्मा';
    if (name.includes('Priya')) return 'डॉ. प्रिया शर्मा';
  }
  return name;
}

function formatRoom(room, lang) {
  if (lang === 'hi') {
    if (room.includes('101')) return 'कमरा 101';
    if (room.includes('102')) return 'कमरा 102';
  }
  return room;
}

// Parse token and language from URL or localStorage
const urlParams = new URLSearchParams(window.location.search);
let currentToken = urlParams.get('token') || localStorage.getItem('triageq_last_token') || '';
let previousStatus = null;
let hasAlertedForCurrentTurn = false;
let syncAttempts = 0;
let soundUnlocked = false;

// Determine language preference
const urlLang = urlParams.get('lang');
let currentLang = (urlLang === 'hi' || urlLang === 'en')
  ? urlLang
  : (localStorage.getItem('triageq_patient_lang') || 'en');

if (currentToken) {
  currentToken = currentToken.trim().toUpperCase();
  localStorage.setItem('triageq_last_token', currentToken);
}

// High-clarity Hospital Announcement Alert: 4-Tone Melodic Chime + Strong Vibration + Spoken Room Announcement
function triggerCallAlert(patient) {
  if (!patient) return;
  console.log('[Patient Alert] Doctor called patient turn:', patient.token);

  // 1. Play crystal-clear 4-tone hospital chime
  playChime('chime');

  // 2. Pulse phone hardware vibrator with 3 distinct pulses
  if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
    try {
      navigator.vibrate([400, 150, 400, 150, 700]);
    } catch (e) {}
  }

  // 3. Clear text-to-speech announcement of room and doctor in chosen language
  try {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      const t = TP[currentLang] || TP.en;
      const formattedDoc = formatDoctorName(patient.doctorName, currentLang);
      const formattedRoom = formatRoom(patient.room, currentLang);
      const speechText = t.speech(patient.token.replace('-', ' '), formattedRoom, formattedDoc);
      const utter = new SpeechSynthesisUtterance(speechText);
      utter.lang = currentLang === 'hi' ? 'hi-IN' : 'en-IN';
      utter.rate = currentLang === 'hi' ? 0.9 : 0.95;
      utter.pitch = 1.05;
      window.speechSynthesis.speak(utter);
    }
  } catch (e) {}
}

// Ensure mobile browser AudioContext is unlocked upon any user interaction
const unlockAudioOnInteraction = () => {
  getAudioContext();
  if (!soundUnlocked) {
    soundUnlocked = true;
    const banner = document.getElementById('sound-activation-banner');
    if (banner && banner.classList.contains('idle')) {
      render();
    }
  }
};
['click', 'touchstart', 'touchend', 'scroll'].forEach(evt => {
  window.addEventListener(evt, unlockAudioOnInteraction, { once: false, passive: true });
});

// Listen for cross-device MQTT patient call announcements (e.g. doctor clicks Call / Recall)
window.addEventListener('triageq_patient_call', e => {
  const info = e.detail;
  if (info && info.token && currentToken && info.token === currentToken) {
    let patient = getPatientToken(currentToken);
    if (patient) {
      patient.status = 'SERVING';
      if (info.doctorName) patient.doctorName = info.doctorName;
      if (info.room) patient.room = info.room;
      triggerCallAlert(patient);
      render();
    }
  }
});

function toggleLanguage() {
  currentLang = (currentLang === 'hi') ? 'en' : 'hi';
  localStorage.setItem('triageq_patient_lang', currentLang);
  const u = new URL(window.location);
  u.searchParams.set('lang', currentLang);
  window.history.replaceState({}, '', u);
  render();
}

function render() {
  if (!currentToken) {
    renderTokenInput();
    return;
  }

  const patient = getPatientToken(currentToken);
  if (!patient) {
    if (syncAttempts < 3) {
      syncAttempts++;
      renderLoading();
      setTimeout(render, 800);
      return;
    }
    renderTokenNotFound();
    return;
  }
  syncAttempts = 0;

  // Adopt patient's language from token if not explicitly overridden by URL
  if (!urlLang && !localStorage.getItem('triageq_patient_lang') && patient.language && (patient.language === 'hi' || patient.language === 'en')) {
    currentLang = patient.language;
  }

  // Trigger alert when status becomes SERVING
  if (patient.status === 'SERVING' && !hasAlertedForCurrentTurn) {
    hasAlertedForCurrentTurn = true;
    triggerCallAlert(patient);
  } else if (patient.status !== 'SERVING') {
    hasAlertedForCurrentTurn = false;
  }
  previousStatus = patient.status;

  renderTracker(patient);
}

// Loading state while connecting to cloud MQTT
function renderLoading() {
  const t = TP[currentLang] || TP.en;
  appEl.innerHTML = `
    <div class="patient-wrapper">
      <div class="patient-header-bar">
        <div>
          <div class="portal-brand">${t.portalBrand}</div>
          <small class="text-mut">${t.liveTracker}</small>
        </div>
        <div style="display:flex; align-items:center; gap:8px;">
          <button id="btn-toggle-lang" class="portal-chip text-btn" style="padding:4px 10px; font-weight:700; border:1px solid #cbd5e1; background:#f8fafc; border-radius:6px; cursor:pointer; font-size:0.8rem; color:#0f172a!important;">
            ${currentLang === 'hi' ? 'English' : 'हिन्दी'}
          </button>
          <div class="patient-header-right">
            <span class="live-dot-pulse"></span>
            <span style="font-size:0.75em; font-weight:700; color:var(--ok)">${t.connecting}</span>
          </div>
        </div>
      </div>
      <div class="patient-card text-center" style="margin-top: 8vh; padding: 40px 20px;">
        <div class="clinical-spinner-box"><div class="clinical-spinner"></div></div>
        <h2>${t.syncing}</h2>
        <p class="text-mut" style="margin-top: 8px;">${t.syncingDesc} <b style="color:var(--p)">${currentToken}</b></p>
      </div>
    </div>
  `;
  document.getElementById('btn-toggle-lang')?.addEventListener('click', toggleLanguage);
}

// 1. Manual Token Input View
function renderTokenInput() {
  const t = TP[currentLang] || TP.en;
  appEl.innerHTML = `
    <div class="patient-wrapper">
      <div class="patient-header-bar">
        <div>
          <div class="portal-brand">${t.portalBrand}</div>
          <small class="text-mut">${t.liveTracker}</small>
        </div>
        <div style="display:flex; align-items:center; gap:8px;">
          <button id="btn-toggle-lang" class="portal-chip text-btn" style="padding:4px 10px; font-weight:700; border:1px solid #cbd5e1; background:#f8fafc; border-radius:6px; cursor:pointer; font-size:0.8rem; color:#0f172a!important;">
            ${currentLang === 'hi' ? 'English' : 'हिन्दी'}
          </button>
          <div class="patient-header-right">
            <span class="live-dot-pulse"></span>
            <span style="font-size:0.75em; font-weight:700; color:var(--ok)">PORTAL</span>
          </div>
        </div>
      </div>

      <div class="patient-card text-center" style="margin-top: 5vh;">
        <h2>${t.trackTurn}</h2>
        <p class="text-mut" style="margin: 1rem 0 2rem;">
          ${t.enterTokenDesc}
        </p>

        <form id="token-search-form" class="token-input-form">
          <input 
            type="text" 
            id="token-input" 
            placeholder="e.g. GS-001" 
            maxlength="10" 
            autocomplete="off" 
            class="patient-token-field"
            required
          />
          <button type="submit" class="big" style="width: 100%; min-height: 60px;">${t.trackBtn}</button>
        </form>

        <div style="margin-top: 2rem; font-size: 0.85em; color: var(--mut);">
          ${t.scanHint}
        </div>
      </div>
    </div>
  `;

  document.getElementById('btn-toggle-lang')?.addEventListener('click', toggleLanguage);
  document.getElementById('token-search-form')?.addEventListener('submit', e => {
    e.preventDefault();
    const val = document.getElementById('token-input').value.trim().toUpperCase();
    if (val) {
      currentToken = val;
      localStorage.setItem('triageq_last_token', currentToken);
      const newUrl = new URL(window.location);
      newUrl.searchParams.set('token', currentToken);
      window.history.pushState({}, '', newUrl);
      render();
    }
  });
}

// 2. Token Not Found View
function renderTokenNotFound() {
  const t = TP[currentLang] || TP.en;
  appEl.innerHTML = `
    <div class="patient-wrapper">
      <div class="patient-header-bar">
        <div>
          <div class="portal-brand">${t.portalBrand}</div>
          <small class="text-mut">${t.liveTracker}</small>
        </div>
        <div style="display:flex; align-items:center; gap:8px;">
          <button id="btn-toggle-lang" class="portal-chip text-btn" style="padding:4px 10px; font-weight:700; border:1px solid #cbd5e1; background:#f8fafc; border-radius:6px; cursor:pointer; font-size:0.8rem; color:#0f172a!important;">
            ${currentLang === 'hi' ? 'English' : 'हिन्दी'}
          </button>
          <div class="patient-header-right">
            <span class="live-dot-pulse"></span>
            <span style="font-size:0.75em; font-weight:700; color:var(--ok)">PORTAL</span>
          </div>
        </div>
      </div>

      <div class="patient-card text-center" style="margin-top: 5vh;">
        <h2>${t.notFoundTitle}</h2>
        <p class="text-mut" style="margin: 1rem 0;">
          ${t.notFoundDesc} <b style="color:var(--p)">"${currentToken}"</b>
        </p>
        <p class="text-mut" style="font-size: 0.9em; margin-bottom: 2rem;">
          ${t.notFoundHint}
        </p>
        <button id="btn-re-enter" class="alt" style="width: 100%;">${t.enterAnother}</button>
      </div>
    </div>
  `;

  document.getElementById('btn-toggle-lang')?.addEventListener('click', toggleLanguage);
  document.getElementById('btn-re-enter')?.addEventListener('click', () => {
    currentToken = '';
    localStorage.removeItem('triageq_last_token');
    render();
  });
}

// 3. Live Queue Tracker View
function renderTracker(p) {
  const t = TP[currentLang] || TP.en;
  let statusBannerHtml = '';
  const formattedDoctor = formatDoctorName(p.doctorName, currentLang);
  const formattedRoom = formatRoom(p.room, currentLang);

  if (p.status === 'SERVING') {
    statusBannerHtml = `
      <div class="patient-status-card status-serving" id="serving-card-tap" style="cursor:pointer; background-color:#ecfdf5!important;border:2px solid var(--ok)!important;color:#0f172a!important;">
        <div class="status-pulse-badge">${t.yourTurn}</div>
        <h1 class="status-big-title" style="color:#064e3b!important;">${t.proceedTo} ${formattedRoom}</h1>
        <p class="status-desc" style="color:#047857!important;">${formattedDoctor} ${t.docReady}</p>
        <div class="room-highlight-box" style="background:#ffffff!important;color:#047857!important;">${p.room}</div>
        <button id="btn-replay-serving-alert" class="big" style="margin-top:12px; width:100%; min-height:48px; background:var(--ok); font-size:0.85em; font-weight:700;">
          ${t.replayAlert}
        </button>
      </div>
    `;
  } else if (p.status === 'WAITING') {
    const ahead = Math.max(0, p.position - 1);
    statusBannerHtml = `
      <div class="patient-status-card status-waiting" style="background-color:#f0f9ff!important;border:1.5px solid #bae6fd!important;color:#0f172a!important;">
        <div class="status-pill" style="background:#ffffff!important;color:var(--p)!important;">${t.waitingInQueue}</div>
        <h2 class="status-big-title" style="color:#0f172a!important;">${ahead === 0 ? t.nextInLine : t.aheadCount(ahead)}</h2>
        <div class="queue-eta-badge" style="background:#ffffff!important;color:var(--p)!important;">
          <span>${t.estWait} <b>~${p.etaMinutes} ${t.mins}</b></span>
        </div>
        <p class="status-desc" style="color:#475569!important;">
          ${t.waitingHint}
        </p>
      </div>
    `;
  } else if (p.status === 'COMPLETED') {
    statusBannerHtml = `
      <div class="patient-status-card status-completed" style="background-color:#f8fafc!important;border:1.5px solid #e2e8f0!important;color:#0f172a!important;">
        <div class="status-pill status-pill-ok" style="background:#ffffff!important;color:var(--ok)!important;">${t.completedTitle}</div>
        <h2 class="status-big-title" style="color:#0f172a!important;">${t.thankYou} ${p.name}</h2>
        <p class="status-desc" style="color:#475569!important;">${t.completedDesc}</p>
        <p style="margin-top: 1rem; font-weight: 700; color: var(--ok)!important;">${t.completedFoot}</p>
      </div>
    `;
  }

  // Audio / Vibration unlock test banner
  const soundBannerHtml = !soundUnlocked
    ? `
      <div id="sound-activation-banner" class="sound-alert-banner idle" style="cursor:pointer; background:#eff6ff!important; border:1.5px solid #bfdbfe!important; border-radius:12px; padding:12px 16px; margin-bottom:14px; display:flex; align-items:center; justify-content:space-between; color:#1e40af!important;">
        <div style="display:flex; align-items:center; gap:10px;">
          <span class="live-dot-pulse" style="background:#2563eb;"></span>
          <span style="font-size:0.82em; font-weight:700; color:#1e40af!important;">
            ${t.soundBannerIdle}
          </span>
        </div>
        <span style="font-size:0.75em; background:#2563eb; color:#ffffff!important; padding:4px 10px; border-radius:6px; font-weight:700;">TEST</span>
      </div>
    `
    : `
      <div id="sound-activation-banner" class="sound-alert-banner active" style="cursor:pointer; background:#f0fdf4!important; border:1.5px solid #bbf7d0!important; border-radius:12px; padding:10px 16px; margin-bottom:14px; display:flex; align-items:center; justify-content:space-between; color:#166534!important;">
        <div style="display:flex; align-items:center; gap:8px;">
          <span style="display:inline-block; width:8px; height:8px; border-radius:50%; background:#16a34a;"></span>
          <span style="font-size:0.8em; font-weight:700; color:#166534!important;">
            ${t.soundBannerActive}
          </span>
        </div>
        <span style="font-size:0.75em; color:#166534!important; font-weight:700; text-decoration:underline;">TEST</span>
      </div>
    `;

  const localizedSymptoms = (p.symptoms || []).map(s => t.symptomMap[s] || s).join(', ') || t.routine;

  appEl.innerHTML = `
    <div class="patient-wrapper" style="background-color:#ffffff!important;color:#0f172a!important;">
      <header class="patient-header-bar" style="background-color:#ffffff!important;color:#0f172a!important;">
        <div>
          <div class="portal-brand" style="color:var(--p)!important;">${t.portalBrand}</div>
          <small class="text-mut" style="color:#64748b!important;">${t.liveTracker}</small>
        </div>
        <div style="display:flex; align-items:center; gap:8px;">
          <button id="btn-toggle-lang" class="portal-chip text-btn" style="padding:4px 10px; font-weight:700; border:1px solid #cbd5e1; background:#f8fafc; border-radius:6px; cursor:pointer; font-size:0.8rem; color:#0f172a!important;">
            ${currentLang === 'hi' ? 'English' : 'हिन्दी'}
          </button>
          <div class="patient-header-right" style="background:#f0fdf4!important;border:1px solid #bbf7d0!important;">
            <span class="live-dot-pulse"></span>
            <span style="font-size:0.75em; font-weight:700; color:var(--ok)!important;">${t.live}</span>
          </div>
        </div>
      </header>

      <div class="patient-content-container" style="background-color:#ffffff!important;color:#0f172a!important;">
        <!-- Audio & Vibration Verification Banner -->
        ${soundBannerHtml}

        <!-- Patient & Token Card -->
        <div class="patient-card" style="background-color:#ffffff!important;border:1px solid #e2e8f0!important;color:#0f172a!important;">
          <div class="patient-token-hero" style="background:#f8fafc!important;border:1px solid #e2e8f0!important;color:#0f172a!important;">
            <span class="patient-token-label" style="color:#64748b!important;">${t.yourToken}</span>
            <span class="patient-token-number" style="color:var(--p)!important;">${p.token}</span>
            ${p.isEmergency ? `<span class="badge-danger" style="margin-top:6px;">${t.critPriority}</span>` : ''}
          </div>

          <div class="patient-meta-grid">
            <div class="meta-item" style="background:#f8fafc!important;border:1px solid #f1f5f9!important;color:#0f172a!important;">
              <span class="meta-label" style="color:#64748b!important;">${t.patientName}</span>
              <span class="meta-val" style="color:#0f172a!important;">${p.name} (${p.age} ${t.ageYrs})</span>
            </div>
            <div class="meta-item" style="background:#f8fafc!important;border:1px solid #f1f5f9!important;color:#0f172a!important;">
              <span class="meta-label" style="color:#64748b!important;">${t.assignedDoc}</span>
              <span class="meta-val" style="color:#0f172a!important;">${formattedDoctor}</span>
            </div>
            <div class="meta-item" style="background:#f8fafc!important;border:1px solid #f1f5f9!important;color:#0f172a!important;">
              <span class="meta-label" style="color:#64748b!important;">${t.room}</span>
              <span class="meta-val highlight-val" style="color:var(--p)!important;">${formattedRoom}</span>
            </div>
            <div class="meta-item" style="background:#f8fafc!important;border:1px solid #f1f5f9!important;color:#0f172a!important;">
              <span class="meta-label" style="color:#64748b!important;">${t.symptoms}</span>
              <span class="meta-val" style="color:#0f172a!important;">${localizedSymptoms}</span>
            </div>
            ${p.vitals ? `
              <div class="meta-item" style="background:#f8fafc!important;border:1px solid #f1f5f9!important;color:#0f172a!important; grid-column: span 2;">
                <span class="meta-label" style="color:#64748b!important;">${t.vitalsTitle}</span>
                <span class="meta-val" style="color:#0f172a!important;">
                  <b>${p.vitals.temp !== null && p.vitals.temp !== undefined ? p.vitals.temp + ' °F' : '-- °F'}</b> &bull; SpO2: <b>${p.vitals.spo2 !== null && p.vitals.spo2 !== undefined ? p.vitals.spo2 + '%' : '--'}</b> &bull; Pulse: ${p.vitals.pulse !== null && p.vitals.pulse !== undefined ? p.vitals.pulse + ' bpm' : '--'}
                  ${p.vitals.isFever ? `<span class="badge-danger" style="margin-left:6px;">FEVER FLAG</span>` : ''}
                  ${p.vitals.isHypoxia ? `<span class="badge-danger" style="margin-left:6px; background:#fffbeb!important; color:#92400e!important; border:1px solid #fbbf24;">LOW O2</span>` : ''}
                </span>
              </div>
            ` : ''}
          </div>
        </div>

        <!-- Live Status Card -->
        ${statusBannerHtml}

        <!-- Emergency / SOS Help Button -->
        <div class="patient-sos-container" style="background:#fff5f5!important;border:1.5px solid #fecdd3!important;color:#0f172a!important;">
          <p class="text-mut" style="font-size:0.8em; margin-bottom: 0.5rem; color:#9b2c2c!important;">${t.sosPrompt}</p>
          <button class="patient-sos-btn" id="btn-patient-sos">
            ${t.sosBtn}
          </button>
        </div>

        <!-- Switch Token / Refresh Footer -->
        <div class="patient-footer-row" style="justify-content:center;">
          <button class="portal-chip text-btn" id="btn-change-token" style="color:#64748b!important;">${t.trackDiff}</button>
        </div>
      </div>
    </div>
  `;

  // Language toggle click
  document.getElementById('btn-toggle-lang')?.addEventListener('click', toggleLanguage);

  // Sound test banner click
  document.getElementById('sound-activation-banner')?.addEventListener('click', () => {
    soundUnlocked = true;
    playTestBeep();
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      try { navigator.vibrate(100); } catch (e) {}
    }
    render();
  });

  // Replay alert on serving card
  const replayBtn = document.getElementById('btn-replay-serving-alert');
  if (replayBtn) {
    replayBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      soundUnlocked = true;
      triggerCallAlert(p);
    });
  }

  // Tapping the serving card also activates alert
  document.getElementById('serving-card-tap')?.addEventListener('click', () => {
    soundUnlocked = true;
    triggerCallAlert(p);
  });

  // Change token click
  document.getElementById('btn-change-token')?.addEventListener('click', () => {
    currentToken = '';
    localStorage.removeItem('triageq_last_token');
    render();
  });

  // Emergency SOS click
  document.getElementById('btn-patient-sos')?.addEventListener('click', () => {
    showSosConfirmation(p);
  });
}

// 4. Patient SOS Confirmation Modal
function showSosConfirmation(patient) {
  const t = TP[currentLang] || TP.en;
  const formattedDoctor = formatDoctorName(patient.doctorName, currentLang);
  sosModalEl.className = 'on';
  sosModalEl.innerHTML = `
    <div class="pin-modal-card text-center" style="border: 4px solid var(--red);">
      <div class="clinical-alert-badge">EMERGENCY</div>
      <h2 style="color: var(--red); margin: 0.5rem 0;">${t.sosModalTitle}</h2>
      <p style="margin: 1.2rem 0; font-weight: 600;">
        ${t.sosModalDesc(formattedDoctor)}
      </p>
      <div class="row" style="width: 100%; gap: 1rem;">
        <button id="btn-confirm-sos" style="background: var(--red); flex: 1; min-height: 54px;">
          ${t.confirmSos}
        </button>
        <button id="btn-cancel-sos" class="alt" style="flex: 1; min-height: 54px;">
          ${t.cancel}
        </button>
      </div>
    </div>
  `;

  document.getElementById('btn-cancel-sos')?.addEventListener('click', () => {
    sosModalEl.className = '';
  });

  document.getElementById('btn-confirm-sos')?.addEventListener('click', async () => {
    await raiseEmergency({ token: patient.token, doctorId: patient.doctorId, patientName: patient.name });
    sosModalEl.innerHTML = `
      <div class="pin-modal-card text-center" style="border: 4px solid var(--red);">
        <div class="clinical-alert-badge">ALERT ACTIVE</div>
        <h2 style="color: var(--red); margin: 0.5rem 0;">${t.sosSentTitle}</h2>
        <p style="margin: 1.2rem 0; font-weight: 700;">
          ${t.sosSentDesc}
        </p>
        <button id="btn-close-sos" style="background: var(--ok); width: 100%;">
          ${t.acknowledge}
        </button>
      </div>
    `;
    document.getElementById('btn-close-sos')?.addEventListener('click', () => {
      sosModalEl.className = '';
    });
  });
}

// Real-time synchronization
initMqtt();
onQueueUpdate(() => {
  render();
});

// Polling interval every 4 seconds as a fallback
setInterval(() => {
  if (currentToken) {
    render();
  }
}, 4000);

// Initial start
render();

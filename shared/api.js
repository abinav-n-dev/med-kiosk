// Central API & State Management for TriageQ (Kiosk, Doctor Panel, Patient Mobile Tracker)
export const USE_MOCK = true, OTP_BYPASS = true, SHOW_DEMO_HINTS = true;

// Two Registered Doctors
export const DOCTORS = [
  {
    id: 'GS',
    name: 'Dr. Gaurav Sharma',
    room: 'Room 101',
    specialty: { en: 'General & Internal Medicine', hi: 'सामान्य एवं आंतरिक चिकित्सा' },
    initials: 'GS',
    color: '#0e7490',
    pin: '1111',
    badge: 'Senior Consultant',
    experience: '18 yrs exp'
  },
  {
    id: 'PS',
    name: 'Dr. Priya Sharma',
    room: 'Room 102',
    specialty: { en: 'Pediatrics & Family Care', hi: 'बाल रोग एवं परिवार देखभाल' },
    initials: 'PS',
    color: '#155e75',
    pin: '2222',
    badge: 'Child & Family Specialist',
    experience: '12 yrs exp'
  }
];

const KNOWN = {
  '9876543210': { name: 'Rajesh Kumar', age: '45' },
  '9812345678': { name: 'Sunita Devi', age: '32' }
};

// Initial state with active demo patients
const getInitialState = () => ({
  seq: { GS: 2, PS: 1 },
  emergency: false,
  doctors: {
    GS: {
      serving: {
        token: 'GS-001',
        doctorId: 'GS',
        doctorName: 'Dr. Gaurav Sharma',
        room: 'Room 101',
        name: 'Rajesh Kumar',
        age: '45',
        phone: '9876543210',
        symptoms: ['Fever', 'Cough'],
        vitals: { temp: 101.2, pulse: 86, isFever: true },
        isEmergency: false,
        status: 'SERVING',
        pagerId: 'P-01',
        createdAt: Date.now() - 600000,
        calledAt: Date.now() - 120000
      },
      queue: [
        {
          token: 'GS-002',
          doctorId: 'GS',
          doctorName: 'Dr. Gaurav Sharma',
          room: 'Room 101',
          name: 'Vikram Joshi',
          age: '38',
          phone: '9812345670',
          symptoms: ['Fever'],
          vitals: { temp: 100.8, pulse: 82, isFever: true },
          isEmergency: false,
          status: 'WAITING',
          pagerId: 'P-02',
          createdAt: Date.now() - 300000,
          calledAt: null
        }
      ],
      completed: []
    },
    PS: {
      serving: null,
      queue: [
        {
          token: 'PS-001',
          doctorId: 'PS',
          doctorName: 'Dr. Priya Sharma',
          room: 'Room 102',
          name: 'Sunita Devi',
          age: '32',
          phone: '9812345678',
          symptoms: ['Child unwell'],
          vitals: { temp: 98.4, pulse: 74, isFever: false },
          isEmergency: false,
          status: 'WAITING',
          pagerId: 'P-03',
          createdAt: Date.now() - 180000,
          calledAt: null
        }
      ],
      completed: []
    }
  }
});

let memCache = null;

const getStoredItem = (k) => {
  try {
    if (typeof localStorage !== 'undefined') return localStorage.getItem(k);
  } catch (e) {}
  return memCache;
};

const setStoredItem = (k, val) => {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(k, val);
  } catch (e) {}
  memCache = val;
};

const STORAGE_KEY = 'triageq_state_v2';

export const getState = () => {
  try {
    const raw = getStoredItem(STORAGE_KEY);
    if (!raw) {
      const init = getInitialState();
      setStoredItem(STORAGE_KEY, JSON.stringify(init));
      return init;
    }
    return JSON.parse(raw);
  } catch (e) {
    return getInitialState();
  }
};

const updateListeners = new Set();
const syncChannel = typeof window !== 'undefined' && window.BroadcastChannel ? new BroadcastChannel('triageq_sync_v2') : null;

if (syncChannel) {
  syncChannel.onmessage = e => {
    if (e.data && e.data.type === 'QUEUE_SYNC' && e.data.state) {
      notifyListeners(e.data.state);
    }
  };
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', e => {
    if (e.key === STORAGE_KEY && e.newValue) {
      try {
        notifyListeners(JSON.parse(e.newValue));
      } catch (err) {}
    }
  });
}

function notifyListeners(state) {
  updateListeners.forEach(cb => {
    try { cb(state); } catch (e) { console.error('Listener err:', e); }
  });
}

export function saveAndBroadcast(state) {
  setStoredItem(STORAGE_KEY, JSON.stringify(state));
  if (syncChannel) {
    try { syncChannel.postMessage({ type: 'QUEUE_SYNC', state }); } catch (e) {}
  }
  // Broadcast via MQTT for cross-device sync (e.g. mobile phones scanning QR)
  publishMqttState(state);
  notifyListeners(state);
}

export const onQueueUpdate = cb => {
  updateListeners.add(cb);
  return () => updateListeners.delete(cb);
};

// --- Doctor & Queue Read Helpers ---
export const getDoctors = async () => {
  const s = getState();
  return DOCTORS.map(doc => {
    const docData = s.doctors[doc.id] || { queue: [], serving: null, completed: [] };
    const waitCount = docData.queue.length;
    const nowServing = docData.serving ? docData.serving.token : '-';
    const avgWait = waitCount * 6;
    return {
      ...doc,
      waitCount,
      nowServing,
      avgWaitMinutes: avgWait,
      serving: docData.serving,
      queue: docData.queue
    };
  });
};

export const getDoctorById = id => {
  const s = getState();
  const base = DOCTORS.find(d => d.id === id);
  if (!base) return null;
  const docData = s.doctors[id] || { queue: [], serving: null, completed: [] };
  return {
    ...base,
    serving: docData.serving,
    queue: docData.queue,
    completed: docData.completed
  };
};

export const verifyDoctorPin = (doctorId, pin) => {
  const doc = DOCTORS.find(d => d.id === doctorId);
  return !!(doc && doc.pin === String(pin).trim());
};

export const getQueueSummary = async () => {
  const s = getState();
  let totalWait = 0, servingTokens = [];
  DOCTORS.forEach(d => {
    const docData = s.doctors[d.id];
    if (docData) {
      totalWait += docData.queue.length;
      if (docData.serving) servingTokens.push(docData.serving.token);
    }
  });
  return {
    nowServing: servingTokens.length ? servingTokens.join(', ') : '-',
    waitingCount: totalWait,
    avgWaitMinutes: Math.round(totalWait * 5)
  };
};

// --- Patient & OTP Authentication ---
const wait = () => new Promise(r => setTimeout(r, 200));

export const sendOtp = async p => {
  await wait();
  return OTP_BYPASS && /^\d{10}$/.test(p) ? { ok: true, resendInSeconds: 30 } : { ok: false };
};

export const verifyOtp = async (p, o) => {
  await wait();
  return OTP_BYPASS && /^\d{4}$/.test(o) ? { verified: true, patient: KNOWN[p] || null } : { verified: false, patient: null };
};

// --- Token Creation (Kiosk) ---
export const createToken = async x => {
  await wait();
  const s = getState();
  const docId = x.doctorId || x.departmentId || 'GS';
  const docMeta = DOCTORS.find(d => d.id === docId) || DOCTORS[0];
  
  s.seq[docId] = (s.seq[docId] || 0) + 1;
  const n = s.seq[docId];
  const tokenStr = `${docId}-${String(n).padStart(3, '0')}`;
  
  if (!s.doctors[docId]) {
    s.doctors[docId] = { serving: null, queue: [], completed: [] };
  }
  
  const docQueue = s.doctors[docId].queue;
  const isEmerg = !!x.isEmergency;
  
  // Calculate position ahead
  const pos = isEmerg ? 1 : (docQueue.length + 1);
  const eta = pos * 5;
  const pagerId = 'P-' + String((n % 20) + 1).padStart(2, '0');
  
  const v = x.vitals || {
    temp: null,
    spo2: null,
    pulse: null,
    isFever: false,
    isHypoxia: false
  };

  const params = new URLSearchParams({
    token: tokenStr,
    doc: docId,
    name: x.name || 'Patient',
    room: docMeta.room,
    pos: String(pos),
    eta: String(eta),
    sym: (x.symptoms || []).join(','),
    em: isEmerg ? '1' : '0',
    lang: x.language || 'en',
    tp: v.temp !== null && v.temp !== undefined ? String(v.temp) : '',
    ox: v.spo2 !== null && v.spo2 !== undefined ? String(v.spo2) : '',
    hr: v.pulse !== null && v.pulse !== undefined ? String(v.pulse) : ''
  });
  const isLocal = typeof window !== 'undefined' && window.location && window.location.origin && (window.location.origin.includes('localhost') || window.location.origin.includes('127.0.0.1') || window.location.origin.startsWith('file:'));
  const origin = (typeof window !== 'undefined' && window.location && window.location.origin && !isLocal) ? window.location.origin : 'https://med-kiosk.vercel.app';
  const basePath = '/patient';

  const tokenObj = {
    token: tokenStr,
    doctorId: docId,
    doctorName: docMeta.name,
    room: docMeta.room,
    name: x.name,
    age: x.age,
    phone: x.phone,
    symptoms: x.symptoms || [],
    vitals: v,
    isEmergency: isEmerg,
    language: x.language || 'en',
    status: 'WAITING',
    position: pos,
    etaMinutes: eta,
    pagerId,
    createdAt: Date.now(),
    calledAt: null,
    completedAt: null,
    patientUrl: `${origin}${basePath}?${params.toString()}`
  };
  
  if (isEmerg) {
    // Put emergency patients directly at the front of queue
    docQueue.unshift(tokenObj);
    s.emergency = true;
    raiseEmergency({ kioskId: 'K1', token: tokenStr, doctorId: docId });
  } else {
    docQueue.push(tokenObj);
  }
  
  saveAndBroadcast(s);
  return tokenObj;
};

// --- Doctor Actions ---
export const callNextPatient = (doctorId) => {
  const s = getState();
  const docData = s.doctors[doctorId];
  if (!docData) return null;
  
  // Move current serving to completed if exists
  if (docData.serving) {
    docData.serving.status = 'COMPLETED';
    docData.serving.completedAt = Date.now();
    docData.completed.unshift(docData.serving);
    docData.serving = null;
  }
  
  // Get next patient from queue
  if (docData.queue.length > 0) {
    const nextPatient = docData.queue.shift();
    nextPatient.status = 'SERVING';
    nextPatient.calledAt = Date.now();
    docData.serving = nextPatient;
  }
  
  // Recalculate queue positions
  docData.queue.forEach((p, idx) => {
    p.position = idx + 1;
    p.etaMinutes = (idx + 1) * 5;
  });
  
  // Trigger chime & patient display on ESP32 LCD hardware!
  const docMeta = DOCTORS.find(d => d.id === doctorId) || DOCTORS[0];
  if (docData.serving) {
    notifyEspCall({
      doctorId,
      doctorName: docMeta.name,
      room: docMeta.room,
      token: docData.serving.token,
      patientName: docData.serving.name,
      isEmergency: docData.serving.isEmergency || false
    });
  } else {
    notifyEspChime(doctorId);
  }

  saveAndBroadcast(s);
  return docData;
};

export const completeConsultation = (doctorId) => {
  const s = getState();
  const docData = s.doctors[doctorId];
  if (!docData || !docData.serving) return null;
  
  const finished = docData.serving;
  docData.serving.status = 'COMPLETED';
  docData.serving.completedAt = Date.now();
  docData.completed.unshift(docData.serving);
  docData.serving = null;

  const docMeta = DOCTORS.find(d => d.id === doctorId) || DOCTORS[0];
  // Notify ESP32 display that room is now ready / available
  notifyEspComplete({
    doctorId,
    doctorName: docMeta.name,
    room: docMeta.room,
    token: finished.token
  });
  
  saveAndBroadcast(s);
  return docData;
};

export const clearCompletedPatients = (doctorId) => {
  const s = getState();
  const docData = s.doctors[doctorId];
  if (docData) {
    docData.completed = [];
    saveAndBroadcast(s);
  }
  return docData;
};

export const callEmergencyPatient = (doctorId, tokenStr) => {
  const s = getState();
  const docData = s.doctors[doctorId];
  if (!docData) return null;
  
  const idx = docData.queue.findIndex(p => p.token === tokenStr);
  if (idx === -1) return null;
  
  const emergencyPatient = docData.queue.splice(idx, 1)[0];
  
  // If already serving someone, push them back to head of waiting queue
  if (docData.serving) {
    docData.serving.status = 'WAITING';
    docData.queue.unshift(docData.serving);
  }
  
  emergencyPatient.status = 'SERVING';
  emergencyPatient.calledAt = Date.now();
  docData.serving = emergencyPatient;
  
  docData.queue.forEach((p, i) => {
    p.position = i + 1;
    p.etaMinutes = (i + 1) * 5;
  });

  const docMeta = DOCTORS.find(d => d.id === doctorId) || DOCTORS[0];
  // Broadcast to ESP32 LCD token display & play arrival chime
  notifyEspCall({
    doctorId,
    doctorName: docMeta.name,
    room: docMeta.room,
    token: emergencyPatient.token,
    patientName: emergencyPatient.name,
    isEmergency: emergencyPatient.isEmergency || false
  });
  
  saveAndBroadcast(s);
  return docData;
};

// --- Patient Lookup Helper ---
export const getPatientToken = (tokenStr) => {
  if (!tokenStr) return null;
  const s = getState();
  const query = tokenStr.trim().toUpperCase();
  
  for (const docId of Object.keys(s.doctors)) {
    const docData = s.doctors[docId];
    if (!docData) continue;
    
    // Check currently serving
    if (docData.serving && docData.serving.token === query) {
      return {
        ...docData.serving,
        status: 'SERVING',
        position: 0,
        etaMinutes: 0
      };
    }
    
    // Check waiting queue
    const qIndex = docData.queue.findIndex(p => p.token === query);
    if (qIndex !== -1) {
      const patient = docData.queue[qIndex];
      return {
        ...patient,
        status: 'WAITING',
        position: qIndex + 1,
        etaMinutes: (qIndex + 1) * 5
      };
    }
    
    // Check completed
    const cPatient = docData.completed.find(p => p.token === query);
    if (cPatient) {
      return {
        ...cPatient,
        status: 'COMPLETED',
        position: -1,
        etaMinutes: 0
      };
    }
  }

  // URL Parameter Fallback (Instant zero-delay QR scan loading on mobile)
  if (typeof window !== 'undefined' && window.location.search) {
    const q = new URLSearchParams(window.location.search);
    const urlToken = (q.get('token') || '').trim().toUpperCase();
    if (urlToken === query) {
      const docId = q.get('doc') || 'GS';
      const docMeta = DOCTORS.find(d => d.id === docId) || DOCTORS[0];
      const tp = q.get('tp') ? parseFloat(q.get('tp')) : null;
      const ox = q.get('ox') ? parseInt(q.get('ox'), 10) : null;
      const hr = q.get('hr') ? parseInt(q.get('hr'), 10) : null;
      const fallbackObj = {
        token: query,
        doctorId: docId,
        doctorName: docMeta.name,
        room: q.get('room') || docMeta.room,
        name: q.get('name') || 'Patient',
        age: q.get('age') || '',
        phone: '',
        symptoms: (q.get('sym') || '').split(',').filter(Boolean),
        vitals: { temp: tp, spo2: ox, pulse: hr, isFever: (tp !== null && tp >= 100.4), isHypoxia: (ox !== null && ox < 94) },
        isEmergency: q.get('em') === '1',
        language: q.get('lang') || 'en',
        status: 'WAITING',
        position: parseInt(q.get('pos') || '1', 10),
        etaMinutes: parseInt(q.get('eta') || '5', 10),
        createdAt: Date.now()
      };
      // Seed local storage so subsequent reads find it
      if (!s.doctors[docId]) s.doctors[docId] = { serving: null, queue: [], completed: [] };
      const exists = s.doctors[docId].queue.some(p => p.token === query);
      if (!exists) {
        s.doctors[docId].queue.push(fallbackObj);
        setStoredItem(STORAGE_KEY, JSON.stringify(s));
      }
      return fallbackObj;
    }
  }

  return null;
};

// --- Audio Chimes (Web Audio API - Shared AudioContext for Mobile Autoplay Reliability) ---
let sharedAudioCtx = null;

export const getAudioContext = () => {
  if (typeof window === 'undefined') return null;
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return null;
  if (!sharedAudioCtx) {
    sharedAudioCtx = new AudioCtx();
  }
  if (sharedAudioCtx.state === 'suspended') {
    sharedAudioCtx.resume().catch(() => {});
  }
  return sharedAudioCtx;
};

export const playTestBeep = () => {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(587.33, now); // D5
    osc.frequency.exponentialRampToValueAtTime(880, now + 0.12); // A5
    gain.gain.setValueAtTime(0.4, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.18);
  } catch (e) {}
};

export const playChime = (type = 'chime') => {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }

    if (type === 'emergency') {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(440, ctx.currentTime + 0.3);
      gain.gain.setValueAtTime(0.5, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.3);
    } else {
      // Crisp 4-Tone Melodic Hospital Announcement Chime (C5 -> E5 -> G5 -> C6)
      const now = ctx.currentTime;
      const notes = [
        { f: 523.25, d: 0.18, g: 0.45 }, // C5
        { f: 659.25, d: 0.18, g: 0.50 }, // E5
        { f: 783.99, d: 0.22, g: 0.55 }, // G5
        { f: 1046.50, d: 0.60, g: 0.65 } // C6
      ];
      let offset = 0;
      notes.forEach((n) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = n.f;
        gain.gain.setValueAtTime(n.g, now + offset);
        gain.gain.exponentialRampToValueAtTime(0.001, now + offset + n.d);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now + offset);
        osc.stop(now + offset + n.d);
        offset += 0.15;
      });
    }
  } catch (e) {}
};

// --- MQTT & ESP32 Integration ---
export const MQTT_CONFIG = {
  // HiveMQ is the primary cloud broker (must match ESP32)
  brokers: [
    'wss://broker.hivemq.com:8884/mqtt',
    'wss://broker.emqx.io:8084/mqtt'
  ],
  emergencyTopic: 'triageq/kiosk/emergency',
  stateTopic: 'triageq/queue/state',
  syncTopic: 'triageq/queue/sync',
  vitalsTopic: 'triageq/kiosk/vitals'
};

let mqttClients = [];

export const broadcastVitals = (data) => {
  safePublish(MQTT_CONFIG.vitalsTopic, JSON.stringify(data), { qos: 0 });
};

export const initMqtt = () => {
  if (typeof window !== 'undefined' && window.mqtt && mqttClients.length === 0) {
    MQTT_CONFIG.brokers.forEach(url => {
      try {
        const clientId = 'triageq_' + Math.random().toString(16).slice(2, 8);
        const c = window.mqtt.connect(url, {
          clientId,
          clean: true,
          keepalive: 30,
          connectTimeout: 5000,
          reconnectPeriod: 2000
        });
        c.on('connect', () => {
          console.log('[ESP32-MQTT] Connected to broker:', url);
          c.subscribe(MQTT_CONFIG.emergencyTopic, { qos: 1 });
          c.subscribe(MQTT_CONFIG.stateTopic, { qos: 1 });
          c.subscribe(MQTT_CONFIG.syncTopic, { qos: 0 });
          c.subscribe(MQTT_CONFIG.vitalsTopic, { qos: 0 });
          // Request sync from any active node
          c.publish(MQTT_CONFIG.syncTopic, 'REQ_SYNC', { qos: 0 });
        });
        c.on('message', (topic, payload) => {
          try {
            const msg = payload.toString();
            if (topic === MQTT_CONFIG.vitalsTopic) {
              const v = JSON.parse(msg);
              if (v && (v.temp !== undefined || v.pulse !== undefined || v.spo2 !== undefined || v.dist !== undefined || v.light !== undefined || v.motion !== undefined)) {
                if (typeof window !== 'undefined') {
                  window.dispatchEvent(new CustomEvent('triageq_vitals_update', { detail: v }));
                }
              }
            } else if (topic === MQTT_CONFIG.stateTopic) {
              const incoming = JSON.parse(msg);
              if (incoming && incoming.seq) {
                setStoredItem(STORAGE_KEY, JSON.stringify(incoming));
                notifyListeners(incoming);
              }
            } else if (topic === MQTT_CONFIG.syncTopic && msg.includes('REQ_SYNC')) {
              const current = getState();
              publishMqttState(current);
            } else if (topic === MQTT_CONFIG.emergencyTopic) {
              if (msg.startsWith('CALL:')) {
                const parts = msg.slice(5).split('|');
                const callInfo = {
                  token: (parts[0] || '').trim().toUpperCase(),
                  doctorName: parts[1] || '',
                  room: parts[2] || '',
                  patientName: parts[3] || '',
                  priority: parts[4] || 'NORMAL'
                };
                if (typeof window !== 'undefined') {
                  window.dispatchEvent(new CustomEvent('triageq_patient_call', { detail: callInfo }));
                }
              } else if (msg.includes('EMERGENCY_ON')) {
                const s = getState();
                if (!s.emergency) {
                  s.emergency = true;
                  setStoredItem(STORAGE_KEY, JSON.stringify(s));
                  playChime('emergency');
                  notifyListeners(s);
                }
              } else if (msg.includes('EMERGENCY_OFF')) {
                const s = getState();
                if (s.emergency) {
                  s.emergency = false;
                  setStoredItem(STORAGE_KEY, JSON.stringify(s));
                  notifyListeners(s);
                }
              }
            }
          } catch (e) {}
        });
        c.on('error', e => console.warn('[ESP32-MQTT] Warning from', url, e.message));
        mqttClients.push(c);
      } catch (e) {
        console.warn('[ESP32-MQTT] Init error for', url, e);
      }
    });

    // Mobile sleep & background tab wake-up listener
    if (typeof document !== 'undefined') {
      const reconnectAll = () => {
        mqttClients.forEach(c => {
          try {
            if (c && !c.connected) c.reconnect();
          } catch (e) {}
        });
      };
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden) reconnectAll();
      });
      window.addEventListener('focus', reconnectAll);
      window.addEventListener('online', reconnectAll);
    }
  }
};

// Reliable publisher with automatic retry queue for mobile waking up
export const safePublish = (topic, message, opts = { qos: 1 }) => {
  let sent = false;
  mqttClients.forEach(c => {
    if (c && c.connected) {
      try {
        c.publish(topic, message, opts);
        sent = true;
      } catch (e) {}
    }
  });

  if (!sent) {
    console.warn('[MQTT] Client currently reconnecting. Queuing message for delivery:', topic, message);
    // Force immediate reconnect
    mqttClients.forEach(c => {
      try { if (c && !c.connected) c.reconnect(); } catch (e) {}
    });

    // Retry every 250ms up to 12 times (3 seconds)
    let retries = 0;
    const timer = setInterval(() => {
      retries++;
      mqttClients.forEach(c => {
        if (c && c.connected && !sent) {
          try {
            c.publish(topic, message, opts);
            sent = true;
            clearInterval(timer);
            console.log('[MQTT] Queued message delivered successfully!');
          } catch (e) {}
        }
      });
      if (retries >= 12 || sent) clearInterval(timer);
    }, 250);
  }
  return sent;
};

function publishMqttState(state) {
  const json = JSON.stringify(state);
  safePublish(MQTT_CONFIG.stateTopic, json, { qos: 1, retain: true });
}

export const notifyEspCall = (callData = {}) => {
  const { doctorId = '', doctorName = 'Doctor', room = 'OPD', token = '---', patientName = '', isEmergency = false } = callData;
  const payload = `CALL:${token}|${doctorName}|${room}|${patientName}|${isEmergency ? 'EMERGENCY' : 'NORMAL'}`;
  console.log('[ESP32-MQTT] Broadcasting Patient Call to LCD Display & Buzzer:', payload);
  safePublish(MQTT_CONFIG.emergencyTopic, payload, { qos: 1 });
};

export const notifyEspComplete = ({ doctorId = '', doctorName = 'Doctor', room = 'OPD', token = '' } = {}) => {
  const payload = `DONE:${room}|${doctorName}|${token}`;
  console.log('[ESP32-MQTT] Broadcasting Consultation Done to LCD Display:', payload);
  safePublish(MQTT_CONFIG.emergencyTopic, payload, { qos: 1 });
};

export const notifyEspChime = (doctorId = '') => {
  safePublish(MQTT_CONFIG.emergencyTopic, `CALL_NEXT:${doctorId}`, { qos: 1 });
};

export const raiseEmergency = async (opts = {}) => {
  console.log('[ESP32-MQTT] Raising Emergency Alarm:', opts);
  playChime('emergency');
  safePublish(MQTT_CONFIG.emergencyTopic, 'EMERGENCY_ON', { qos: 1 });
  const s = getState();
  s.emergency = true;

  // If a specific patient token triggered this (e.g. from patient mobile view)
  if (opts.token) {
    for (const docId of Object.keys(s.doctors)) {
      const doc = s.doctors[docId];
      if (!doc) continue;
      const qIdx = doc.queue.findIndex(p => p.token === opts.token);
      if (qIdx !== -1) {
        const [patient] = doc.queue.splice(qIdx, 1);
        patient.isEmergency = true;
        patient.symptoms = patient.symptoms || [];
        if (!patient.symptoms.includes('SOS Alert')) patient.symptoms.unshift('SOS Alert');
        doc.queue.unshift(patient); // Move straight to position 1!
        break;
      }
      if (doc.serving && doc.serving.token === opts.token) {
        doc.serving.isEmergency = true;
        break;
      }
    }
  }

  saveAndBroadcast(s);
  return { ok: true };
};

export const resolveEmergency = async (opts = {}) => {
  console.log('[ESP32-MQTT] Resolving Emergency / Silencing Buzzer:', opts);
  safePublish(MQTT_CONFIG.emergencyTopic, 'EMERGENCY_OFF', { qos: 1, retain: true });
  const s = getState();
  s.emergency = false;
  saveAndBroadcast(s);
  return { ok: true };
};

export const notifyEspKioskStage = (stage, extra = '') => {
  const payload = `STAGE:${stage}${extra ? '|' + extra : ''}`;
  console.log('[ESP32-MQTT] Notifying Kiosk Stage:', payload);
  safePublish(MQTT_CONFIG.emergencyTopic, payload, { qos: 0 });
};

export const notifyEspBreak = (stationName, onBreak = true) => {
  const payload = onBreak ? `BREAK:ON:${stationName}` : `BREAK:OFF:${stationName}`;
  safePublish(MQTT_CONFIG.emergencyTopic, payload, { qos: 1 });
};

export const setDoctorBreak = (doctorId, durationMinutes = 5, reason = 'Water Break') => {
  const s = getState();
  const doc = s.doctors[doctorId];
  if (doc) {
    doc.breakInfo = {
      onBreak: true,
      startedAt: Date.now(),
      durationMinutes,
      reason
    };
    saveAndBroadcast(s);
    notifyEspBreak(doc.name || 'Doctor', true);
  }
  return { ok: true };
};

export const resumeDoctorBreak = (doctorId) => {
  const s = getState();
  const doc = s.doctors[doctorId];
  if (doc) {
    doc.breakInfo = {
      onBreak: false,
      startedAt: null,
      durationMinutes: 0,
      reason: ''
    };
    saveAndBroadcast(s);
    notifyEspBreak(doc.name || 'Doctor', false);
  }
  return { ok: true };
};


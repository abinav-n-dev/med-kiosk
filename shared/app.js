// Kiosk screens. One state object S, one draw() that renders the current step. Clicks use data-a / data-k.
import {
  getDoctors,
  sendOtp,
  verifyOtp,
  createToken,
  getQueueSummary,
  raiseEmergency,
  resolveEmergency,
  initMqtt,
  SHOW_DEMO_HINTS,
  onQueueUpdate,
  notifyEspKioskStage,
  connectWebSerial,
  isWebSerialActive
} from './api.js?v=23.0';
import { T } from './i18n.js?v=22.0';

const $ = document.getElementById('app'), SOS = document.getElementById('sos');
let S, idle, tmr, depts = [], sum = {};

const svgTempTutorial = `
  <svg class="vitals-tutorial-svg" viewBox="0 0 250 120" fill="none" xmlns="http://www.w3.org/2000/svg">
    <!-- Kiosk Sensor Pod Enclosure -->
    <rect x="14" y="16" width="46" height="84" rx="10" fill="#e0f2fe" stroke="#0284c7" stroke-width="2.5"/>
    <!-- Top: MLX90614 Infrared Lens -->
    <circle cx="37" cy="36" r="9" fill="#0284c7"/>
    <circle cx="37" cy="36" r="4.5" fill="#38bdf8"/>
    <text x="37" y="52" text-anchor="middle" font-size="7.5" font-weight="800" fill="#0369a1">MLX90614</text>
    <!-- Bottom: HC-SR04 Dual Ultrasonic Transducers (T & R) -->
    <rect x="20" y="58" width="15" height="15" rx="7.5" fill="#f8fafc" stroke="#475569" stroke-width="2"/>
    <rect x="39" y="58" width="15" height="15" rx="7.5" fill="#f8fafc" stroke="#475569" stroke-width="2"/>
    <circle cx="27.5" cy="65.5" r="3" fill="#64748b"/>
    <circle cx="46.5" cy="65.5" r="3" fill="#64748b"/>
    <text x="37" y="86" text-anchor="middle" font-size="7.5" font-weight="800" fill="#475569">HC-SR04</text>
    <circle cx="37" cy="94" r="3" fill="#22c55e"/>

    <!-- Infrared Wave Beams (Red / Orange) -->
    <path d="M72 32 C80 34, 80 40, 72 42" stroke="#ef4444" stroke-width="2" stroke-linecap="round"/>
    <path d="M84 28 C94 32, 94 42, 84 46" stroke="#f97316" stroke-width="2" stroke-linecap="round"/>
    <path d="M96 24 C108 30, 108 44, 96 50" stroke="#f59e0b" stroke-width="2" stroke-linecap="round"/>

    <!-- Ultrasonic Sonar Waves (Cyan / Blue) -->
    <path d="M72 62 C80 64, 80 70, 72 72" stroke="#0284c7" stroke-width="2" stroke-linecap="round"/>
    <path d="M84 58 C94 62, 94 72, 84 76" stroke="#38bdf8" stroke-width="2" stroke-linecap="round"/>

    <!-- Forehead Measurement Target Reticle -->
    <circle cx="138" cy="38" r="9" stroke="#ef4444" stroke-width="1.5" stroke-dasharray="2 2"/>
    <circle cx="138" cy="38" r="2.5" fill="#ef4444"/>

    <!-- Distance indicator bracket 3-5 cm -->
    <line x1="68" y1="94" x2="130" y2="94" stroke="#64748b" stroke-width="1.5" stroke-dasharray="3 3"/>
    <line x1="68" y1="90" x2="68" y2="98" stroke="#64748b" stroke-width="1.5"/>
    <line x1="130" y1="90" x2="130" y2="98" stroke="#64748b" stroke-width="1.5"/>
    <text x="99" y="108" text-anchor="middle" font-size="10" font-weight="800" fill="#166534">3 - 5 cm TARGET ZONE</text>

    <!-- Professional Human Head Profile (Clean anatomical medical contour) -->
    <path d="M 190 112 L 190 76 C 190 48, 176 20, 150 20 C 140 20, 138 28, 138 38 C 137 43, 135 45, 127 51 C 124 53, 126 56, 132 57 C 129 60, 130 63, 133 65 C 130 69, 131 74, 135 77 C 141 82, 145 92, 148 112 Z" fill="#f8fafc" stroke="#334155" stroke-width="2.2" stroke-linejoin="round"/>
    <!-- Subtle eye and ear line -->
    <path d="M 143 40 C 145 42, 148 42, 150 40" stroke="#64748b" stroke-width="1.5" stroke-linecap="round" fill="none"/>
    <path d="M 164 54 C 167 54, 169 58, 167 65 C 165 68, 162 68, 160 65" stroke="#64748b" stroke-width="1.8" stroke-linecap="round" fill="none"/>
  </svg>
`;

const svgSpo2Tutorial = `
  <svg class="vitals-tutorial-svg" viewBox="0 0 240 120" fill="none" xmlns="http://www.w3.org/2000/svg">
    <!-- Pulse Oximeter Clip Body -->
    <rect x="24" y="52" width="100" height="44" rx="10" fill="#f8fafc" stroke="#0284c7" stroke-width="2.5"/>
    <!-- Top Hinged Jaw -->
    <path d="M 28 38 C 48 35, 88 30, 120 25" stroke="#0284c7" stroke-width="3.5" stroke-linecap="round"/>
    <!-- Pivot Hinge Pin -->
    <circle cx="32" cy="46" r="5" fill="#94a3b8" stroke="#475569" stroke-width="1.5"/>

    <!-- Optical Sensor Window (Red Glow - MAX30102) -->
    <rect x="68" y="58" width="30" height="8" rx="4" fill="#ef4444"/>
    <circle cx="83" cy="62" r="10" fill="#ef4444" opacity="0.25"/>
    <circle cx="83" cy="62" r="5" fill="#f87171"/>
    <text x="74" y="86" text-anchor="middle" font-size="7.5" font-weight="800" fill="#0369a1">MAX30102</text>

    <!-- Pulse Waveform Indicator -->
    <path d="M 135 34 L 145 34 L 150 24 L 155 42 L 160 18 L 165 38 L 170 34 L 180 34" stroke="#ef4444" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>

    <!-- Human Hand & Index Finger into MAX30102 Clip -->
    <path d="M 220 48 L 145 48 C 125 48, 100 50, 72 54 C 60 56, 56 61, 56 67 C 56 73, 62 76, 76 76 L 145 76 L 220 76 Z" fill="#f8fafc" stroke="#334155" stroke-width="2.5" stroke-linejoin="round"/>
    <!-- Fingernail -->
    <rect x="66" y="54" width="18" height="8" rx="3" fill="#e2e8f0" stroke="#94a3b8" stroke-width="1.5"/>
    <!-- Knuckle Creases -->
    <path d="M 130 52 L 130 60 M 133 54 L 133 62" stroke="#94a3b8" stroke-width="1.5" stroke-linecap="round"/>
    <path d="M 180 52 L 180 62 M 183 54 L 183 64" stroke="#94a3b8" stroke-width="1.5" stroke-linecap="round"/>

    <!-- ECG Pulse Rhythm Trace -->
    <path d="M 130 96 L 145 96 L 150 86 L 154 104 L 160 78 L 165 102 L 170 96 L 195 96" stroke="#16a34a" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
    <text x="162" y="112" text-anchor="middle" font-size="8.5" font-weight="800" fill="#15803d">PULSE DETECTED</text>
  </svg>
`;

const playTone = (freq = 440, duration = 0.1, type = 'sine') => {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') {
      ctx.resume();
    }
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    gain.gain.setValueAtTime(0.08, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + duration);
  } catch (e) {}
};

// Persistent hardware telemetry buffer across patient resets (populated by ESP32 MQTT only)
const HW = {
  connected: false,
  lastAt: 0,
  temp: null,
  spo2: null,
  pulse: null,
  dist: null,
  motion: 0,
  motionAt: 0,
  finger: false,
  ir: 0,
  red: 0
};
const isHwLive = () => HW.connected && (Date.now() - HW.lastAt < 10000);

const fresh = l => ({
  step: 'standby',
  lang: l || 'en',
  phone: '',
  otp: '',
  name: '',
  age: '',
  vitals: { temp: null, spo2: null, pulse: null, isFever: false, isHypoxia: false, live: true },
  liveSensorBuffer: { temp: HW.temp, spo2: HW.spo2, pulse: HW.pulse, dist: HW.dist },
  distanceCm: isHwLive() ? HW.dist : null,
  pirWakeEnabled: true,
  vitalsStage: 'tutorial_temp',
  countdownSec: 3,
  secretStaffUnlocked: false,
  secretTapCount: 0,
  lastSecretTapTime: 0,
  dept: '',
  sym: [],
  ok: false,
  known: null,
  tok: null,
  err: '',
  busy: false,
  left: 0
});

const evalDistance = d => {
  if (d === null || d === undefined || isNaN(d)) {
    return {
      status: 'waiting',
      label: t('distWaiting'),
      msg: t('distWaitingMsg'),
      badgeClass: 'dist-badge-wait',
      pillClass: 'pill-neutral',
      color: 'var(--mut)',
      percent: 0,
      inTarget: false
    };
  }
  const dist = Math.round(d);
  if (dist > 15) {
    return {
      status: 'out',
      label: t('distOutOfRange'),
      msg: t('distOutOfRangeMsg'),
      badgeClass: 'dist-badge-danger',
      pillClass: 'pill-danger',
      color: 'var(--red)',
      percent: Math.min(100, Math.max(0, (dist / 20) * 100)),
      inTarget: false
    };
  }
  if (dist > 5) {
    return {
      status: 'far',
      label: `${t('distMoveCloser')} (${dist} cm)`,
      msg: t('distMoveCloserMsg'),
      badgeClass: 'dist-badge-warn',
      pillClass: 'pill-warn',
      color: '#d97706',
      percent: Math.min(100, Math.max(0, (dist / 20) * 100)),
      inTarget: false
    };
  }
  if (dist < 3) {
    return {
      status: 'close',
      label: `${t('distMoveBack')} (${dist} cm)`,
      msg: t('distMoveBackMsg'),
      badgeClass: 'dist-badge-warn',
      pillClass: 'pill-warn',
      color: '#d97706',
      percent: Math.min(100, Math.max(0, (dist / 20) * 100)),
      inTarget: false
    };
  }
  return {
    status: 'perfect',
    label: `${t('distPerfect')} (${dist} cm)`,
    msg: t('distPerfectMsg'),
    badgeClass: 'dist-badge-ok',
    pillClass: 'pill-ok',
    color: 'var(--ok)',
    percent: Math.min(100, Math.max(0, (dist / 20) * 100)),
    inTarget: true
  };
};

const telemetryStripHtml = hwLive => {
  const isUsb = isWebSerialActive();
  const liveTempText = hwLive && HW.temp !== null ? `${HW.temp.toFixed(1)} °F` : '--.- °F';
  const liveSpo2Text = hwLive && HW.spo2 !== null ? `${HW.spo2}%` : '--%';
  const livePulseText = hwLive && HW.pulse !== null ? `${HW.pulse} BPM` : '-- BPM';
  const distText = S.distanceCm === null ? '-- cm' : (S.distanceCm > 15 ? '> 15 cm' : `${S.distanceCm} cm`);
  const motionText = hwLive
    ? ((HW.motion === 1 || (Date.now() - HW.motionAt < 4000)) ? 'DETECTED' : 'CLEAR')
    : '--';
  return `
    <div class="hw-telemetry-strip">
      <div class="hw-telemetry-item"><span>TEMP (MLX90614)</span><b>${liveTempText}</b></div>
      <div class="hw-telemetry-item"><span>SpO2 / HR (MAX30102)</span><b>${liveSpo2Text} · ${livePulseText}</b></div>
      <div class="hw-telemetry-item"><span>ALIGN (HC-SR04)</span><b>${distText}</b></div>
      <div class="hw-telemetry-item"><span>PIR WAKE (HC-SR501)</span><b>${motionText}</b></div>
      <div class="hw-telemetry-item usb-status-item" data-a="connectUsb" style="cursor:pointer;" title="Click to Connect or Reconnect USB Hardware">
        <span>LINK MODE</span>
        <b style="color:${isUsb ? '#059669' : '#0284c7'}">${isUsb ? 'USB 0ms [ACTIVE]' : (hwLive ? 'CLOUD MQTT' : 'CONNECT USB')}</b>
      </div>
    </div>
  `;
};

const t = k => T[S.lang][k];
const fmt = p => p.length > 5 ? p.slice(0, 5) + ' ' + p.slice(5) : p;

const pad = () => `<div class=pad>${[1,2,3,4,5,6,7,8,9,'C',0,'⌫'].map(k => `<button data-k="${k}">${k}</button>`).join('')}</div>`;
const kb = () => `<div class=kb>${['QWERTYUIOP','ASDFGHJKL','ZXCVBNM'].map(r => `<div class=row>${[...r].map(c => `<button data-k="${c}">${c}</button>`).join('')}</div>`).join('')}<div class=row><button data-k=" " style="flex:4">␣</button><button data-k="⌫">⌫</button></div></div>`;
const foot = n => `<button class="fab bk alt" data-a=back>${t('back')}</button><button class="fab sosb" data-a=sos>${t('emerg')}</button>`;
const nav = { name: 'lang', age: 'name', vitals: 'age', dept: 'vitals', sym: 'dept', consent: 'sym', pager: 'consent' };
const next = (l, ok) => `<button ${ok ? '' : 'disabled'} data-a=${l}>${t('next')}</button>`;

const renderSecretMenu = () => {
  if (!S || !S.secretStaffUnlocked) return '';
  const hasFinger = HW.finger === true || (HW.spo2 !== null && HW.spo2 > 0);
  return `
    <div class="secret-modal-backdrop" data-a="overlayClose" style="position:fixed;inset:0;background:rgba(15,23,42,0.75);backdrop-filter:blur(4px);z-index:99999;display:flex;align-items:center;justify-content:center;padding:16px;">
      <div class="secret-staff-modal" style="background:#0f172a;color:#f8fafc;border:2px solid #334155;border-radius:18px;max-width:620px;width:100%;max-height:90vh;overflow-y:auto;box-shadow:0 25px 50px -12px rgba(0,0,0,0.85);padding:20px;text-align:left;">
        
        <div class="secret-staff-header" style="display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #1e293b;padding-bottom:12px;margin-bottom:12px;">
          <div style="display:flex;align-items:center;gap:10px;">
            <span class="secret-staff-badge" style="background:#2563eb;color:#fff;font-size:0.75rem;font-weight:800;padding:4px 10px;border-radius:6px;letter-spacing:0.05em;">STAFF / HARDWARE DIAGNOSTICS</span>
            <span style="font-size:0.75rem;color:#94a3b8;">[ESC] or [O] to exit</span>
          </div>
          <button data-a="hideSecretMenu" style="min-height:36px;padding:4px 14px;background:#334155;color:#f8fafc;border:1px solid #475569;border-radius:8px;font-size:0.85rem;font-weight:700;cursor:pointer;">✕ ${t('closeDrawer')}</button>
        </div>
        
        <p style="font-size:0.75em;color:#94a3b8;margin:0 0 12px 0;">Live Hardware Monitor &bull; Secret Hotkeys: <b>[ O ]</b> or <b>[ ~ / \` ]</b></p>

        <!-- Live MAX30100 Hardware Optical Oximeter Monitor -->
        <div style="background:#1e293b;color:#f8fafc;border:1.5px solid #475569;border-radius:14px;padding:16px;margin-bottom:14px;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
            <div>
              <span style="font-size:0.85rem;text-transform:uppercase;letter-spacing:0.05em;color:#f8fafc;font-weight:800;display:block;">MAX30100 Optical Probe</span>
              <span style="font-size:0.72rem;color:#94a3b8;">Real-time I2C Photodiode Telemetry</span>
            </div>
            <span style="font-size:0.75rem;padding:4px 12px;border-radius:99px;font-weight:800;${hasFinger ? 'background:#064e3b;color:#34d399;border:1px solid #059669;' : 'background:#450a0a;color:#f87171;border:1px solid #dc2626;'}">
              ${hasFinger ? 'FINGER ON SENSOR' : 'NO FINGER (IDLE)'}
            </span>
          </div>

          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;text-align:center;margin-bottom:12px;">
            <div style="background:rgba(255,255,255,0.05);padding:14px;border-radius:12px;border:1px solid rgba(255,255,255,0.08);">
              <div style="font-size:0.75rem;color:#94a3b8;text-transform:uppercase;font-weight:700;">Live SpO2</div>
              <div style="font-size:2.4rem;font-weight:800;color:${hasFinger ? '#34d399' : '#64748b'};margin-top:2px;">
                ${hasFinger && HW.spo2 !== null ? HW.spo2 + '%' : '--'}
              </div>
            </div>
            <div style="background:rgba(255,255,255,0.05);padding:14px;border-radius:12px;border:1px solid rgba(255,255,255,0.08);">
              <div style="font-size:0.75rem;color:#94a3b8;text-transform:uppercase;font-weight:700;">Live Pulse</div>
              <div style="font-size:2.4rem;font-weight:800;color:${hasFinger ? '#38bdf8' : '#64748b'};margin-top:2px;">
                ${hasFinger && HW.pulse !== null ? HW.pulse + ' BPM' : '--'}
              </div>
            </div>
          </div>

          <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:8px;font-size:0.78rem;background:rgba(0,0,0,0.25);padding:10px 12px;border-radius:8px;color:#94a3b8;border:1px solid #334155;text-align:center;">
            <div>Raw IR: <b style="color:${hasFinger ? '#34d399' : '#f8fafc'};">${HW.ir || '--'}</b></div>
            <div>Raw Red: <b style="color:#f8fafc;">${HW.red || '--'}</b></div>
            <div>Temp: <b style="color:#f8fafc;">${HW.temp !== null ? HW.temp + ' °F' : '--'}</b></div>
            <div>Dist: <b style="color:#f8fafc;">${HW.dist !== null ? HW.dist + ' cm' : '--'}</b></div>
          </div>
        </div>

        <!-- Motion Sensor & Idle Screensaver Testing -->
        <div style="background:#1e293b;border:1.5px solid #475569;border-radius:14px;padding:14px;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
            <span style="font-size:0.8em;font-weight:800;color:#f8fafc;">${t('devPirToggle')}:</span>
            <button class="secret-preset-btn" data-a="devTogglePir" style="min-height:30px;padding:2px 12px;font-size:0.75em;background:${S.pirWakeEnabled !== false ? '#064e3b' : '#450a0a'};border:1px solid ${S.pirWakeEnabled !== false ? '#059669' : '#dc2626'};color:${S.pirWakeEnabled !== false ? '#34d399' : '#f87171'};font-weight:800;border-radius:6px;cursor:pointer;">
              ${S.pirWakeEnabled !== false ? t('devEnabled') : t('devDisabled')}
            </button>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
            <button class="secret-preset-btn" data-a="devTriggerMotion" style="min-height:38px;background:#0369a1;border:1px solid #0284c7;color:#fff;font-weight:800;border-radius:8px;cursor:pointer;">
              ${t('devTriggerMotionBtn')}
            </button>
            <button class="secret-preset-btn" data-a="devEnterStandby" style="min-height:38px;background:#334155;border:1px solid #64748b;color:#f8fafc;font-weight:800;border-radius:8px;cursor:pointer;">
              ${t('devEnterStandbyBtn')}
            </button>
          </div>
        </div>
      </div>
    </div>
  `;
};

function screen() {
  const s = S.step, e = `<div class=err>${S.err}</div>`;

  if (s === 'standby') {
    const hasMotion = HW.motion === 1 || (Date.now() - HW.motionAt < 4000);
    return `
      <div class="standby-wrap" data-a="wake">
        <div class="standby-badge" data-a="secretTap" style="cursor:pointer;" title="Tap 3 times for Dev Menu">${t('standbyBadge')}</div>
        <h1 data-a="secretTap" style="margin-bottom:6px; cursor:pointer;" title="Tap 3 times for Dev Menu">${t('standbyTitle')}</h1>
        <p style="color:var(--mut);font-size:clamp(14px,1.8vmin,18px);margin-bottom:1.5vmin">${t('standbySubtitle')}</p>
        
        <div class="standby-radar-container">
          <div class="standby-radar-ring"></div>
          <div class="standby-radar-ring"></div>
          <div class="standby-radar-ring"></div>
          <div class="standby-radar-core ${hasMotion ? 'motion-active' : ''}">
            <span>PIR</span>
            <span>${hasMotion ? 'ACTIVE' : 'READY'}</span>
          </div>
        </div>
        
        <div class="standby-prompt-card">
          <div class="standby-prompt-main">${t('standbyPrompt')}</div>
          <div class="standby-prompt-sub">${t('standbySubPrompt')}</div>
          <button class="standby-wake-btn" data-a="wake">${t('wakeBtn')}</button>
        </div>

        <div class="strip" style="margin-top:1vmin">
          <span>${t('now')}: <b>${sum.nowServing || '-'}</b></span>
          <span>${t('wait')}: <b>${sum.waitingCount ?? '-'}</b></span>
          <span>${t('avg')}: <b>${sum.avgWaitMinutes ?? '-'} ${t('min')}</b></span>
        </div>

        <div class="standby-sensor-note">
          <span class="standby-sensor-dot"></span>
          <span>${hasMotion ? t('motionDetected') : (isHwLive() ? t('hwLiveSensors') : t('motionWatching'))}</span>
        </div>

        <button class="fab sosb" data-a="sos">${t('emerg')}</button>
      </div>
    `;
  }

  if (s === 'lang') {
    return `
      <h1 data-a="secretTap" style="cursor:pointer;" title="Tap 3 times for Dev Menu">${t('sel')}</h1>
      <div class=row>
        <button class=big data-a=en>English</button>
        <button class=big data-a=hi>हिन्दी</button>
      </div>
      <div class=strip>
        <span>${t('now')}: <b>${sum.nowServing || '-'}</b></span>
        <span>${t('wait')}: <b>${sum.waitingCount ?? '-'}</b></span>
        <span>${t('avg')}: <b>${sum.avgWaitMinutes ?? '-'} ${t('min')}</b></span>
      </div>
      <button class="fab sosb" data-a=sos>${t('emerg')}</button>
    `;
  }

  if (s === 'phone') {
    return `
      <h2>${t('phoneH')}</h2>
      <div class=disp>+91 ${fmt(S.phone) || '&nbsp;'}</div>
      ${e}${pad()}
      <button ${S.phone.length === 10 && !S.busy ? '' : 'disabled'} data-a=send>${t('send')}</button>
      ${SHOW_DEMO_HINTS ? `<div class=hint>${t('demo')}</div>` : ''}
    `;
  }

  if (s === 'otp') {
    return `
      <h2>${t('otpH')}<br>+91 ${fmt(S.phone)}</h2>
      <div class=boxes>${[0,1,2,3].map(i => `<span>${S.otp[i] || ''}</span>`).join('')}</div>
      ${e}${pad()}
      <div class=row>
        <button ${S.otp.length === 4 && !S.busy ? '' : 'disabled'} data-a=verify>${t('verify')}</button>
        <button class=alt ${S.left ? 'disabled' : ''} data-a=resend>${S.left ? t('resend') + ' ' + S.left + 's' : t('resendNow')}</button>
        <button class=alt data-a=change>${t('change')}</button>
      </div>
      ${SHOW_DEMO_HINTS ? `<div class=hint>${t('demo')}</div>` : ''}
    `;
  }

  if (s === 'ask') {
    return `
      <h2>${t('welcome')}</h2>
      <h1>${S.known.name}</h1>
      <p>${t('isyou')}</p>
      <div class=row>
        <button class=big data-a=yes>${t('yes')}</button>
        <button class="big alt" data-a=no>${t('no')}</button>
      </div>
    `;
  }

  if (s === 'name') {
    return `
      <h2>${t('nameH')}</h2>
      <div class=disp>${S.name || '&nbsp;'}</div>
      ${kb()}
      ${next('toAge', S.name.trim().length > 1)}
    `;
  }

  if (s === 'age') {
    return `
      <h2>${t('ageH')}</h2>
      <div class=disp>${S.age || '&nbsp;'}</div>
      ${pad()}
      ${next('toVitals', +S.age > 0 && +S.age < 120)}
    `;
  }

  // Automated Vitals Screen
  if (s === 'vitals') {
    const hwLive = isHwLive();
    const v = S.vitals || { temp: null, spo2: null, pulse: null, isFever: false, isHypoxia: false, live: true };
    const isFever = v.temp !== null && v.temp >= 100.4;
    const isHypoxia = v.spo2 !== null && v.spo2 < 94;

    if (S.vitalsStage === 'tutorial_temp') {
      const distInfo = evalDistance(S.distanceCm);
      const canScanTemp = distInfo.inTarget || (S.distanceCm !== null && S.distanceCm >= 3 && S.distanceCm <= 5);
      const hwLabel = hwLive ? t('hwLiveSensors') : t('hwOffline');
      const distBadgeText = S.distanceCm === null
        ? '-- cm'
        : (S.distanceCm > 15 ? '> 15 cm' : `${S.distanceCm} cm`);

      return `
        <h2 data-a="secretTap" style="cursor:pointer; user-select:none;" title="Staff controls">${t('vitalsH')}</h2>
        <p class=hint style="margin-bottom:1vmin">${t('vitalsSub')}</p>

        <div class="vitals-tutorial-box">
          <span class="scanning-step-badge">${t('step1Badge')}</span>
          <div class="vitals-svg-wrap">${svgTempTutorial}</div>
          <div class="vitals-tutorial-title">${t('step1Title')}</div>
          <div class="vitals-tutorial-desc">${t('step1Desc')}</div>

          <!-- Real-Time ESP32 HC-SR04 Ultrasonic Alignment Guide -->
          <div class="ultrasonic-meter-card">
            <div class="hw-status-pill ${hwLive ? 'live' : 'wait'}">
              <span class="live-dot-pulse" style="${hwLive ? '' : 'background:#d97706; box-shadow:0 0 0 3px rgba(217,119,6,0.2);'}"></span>
              <span>${hwLabel}</span>
            </div>

            <div class="ultrasonic-header">
              <span class="ultrasonic-title">${t('distGuideTitle')}</span>
              <span class="dist-val-badge ${distInfo.badgeClass}">
                ${distBadgeText}
              </span>
            </div>

            <div class="dist-status-text" style="color:${distInfo.color};">
              ${distInfo.label}
            </div>
            <div style="font-size:0.8em; color:#475569; margin-bottom:8px;">
              ${distInfo.msg}
            </div>

            <!-- Distance Track Bar with 3-5 cm Target highlighted -->
            <div class="dist-track-wrap">
              <div class="dist-zone-close" title="< 3 cm (Too Close)"></div>
              <div class="dist-zone-target" title="3 - 5 cm (Optimal Range)">
                <span class="dist-target-marker">3-5 cm</span>
              </div>
              <div class="dist-zone-far" title="6 - 15 cm (Move Closer)"></div>
              <div class="dist-zone-out" title="> 15 cm (Out of Range)"></div>
              ${S.distanceCm !== null ? `<div class="dist-needle" style="left:${distInfo.percent}%;"></div>` : ''}
            </div>

            <!-- Live Incoming Clinical Sensor Telemetry -->
            ${telemetryStripHtml(hwLive)}
          </div>

          ${S.err ? `<div class="err" style="font-size:0.85em; margin-bottom:6px;">${S.err}</div>` : ''}

          <button class="btn-ready-scan ${canScanTemp ? 'locked' : 'disabled-align'}" data-a="readyTemp" ${canScanTemp ? '' : 'disabled'}>
            ${canScanTemp ? t('btnStartScanReady') : t('btnStartScanLocked')}
          </button>
        </div>
      `;
    }

    if (S.vitalsStage === 'countdown_temp') {
      return `
        <h2 data-a="secretTap" style="cursor:pointer; user-select:none;" title="Staff controls">${t('vitalsH')}</h2>
        <p class=hint style="margin-bottom:1vmin">${t('vitalsSub')}</p>

        <div class="vitals-countdown-box">
          <span class="scanning-step-badge">${t('step1Badge')}</span>
          <div class="countdown-hero-circle">
            <span class="countdown-digit">${S.countdownSec}</span>
          </div>
          <div class="countdown-submsg">${t('holdStill')} ${S.countdownSec}s...</div>
          <p class="vitals-tutorial-hint" style="margin:4px 0;">${t('measuringTemp')}</p>
          <div class="countdown-indicator-bar">
            <div class="countdown-indicator-fill" style="width:${(4 - S.countdownSec) * 33.3}%"></div>
          </div>
        </div>
      `;
    }

    if (S.vitalsStage === 'tutorial_spo2') {
      const hasLiveFinger = hwLive && (HW.finger === true || (HW.spo2 !== null && HW.spo2 > 0));
      const canScanSpo2 = true;
      const hwLabel = hwLive ? t('hwLiveSensors') : t('hwOffline');

      const spo2BadgeClass = hasLiveFinger ? 'dist-badge-ok' : (hwLive ? 'dist-badge-warn' : 'dist-badge-wait');
      const spo2StatusTitle = hasLiveFinger ? t('spo2Detected') : t('spo2Waiting');
      const spo2StatusMsg = hasLiveFinger ? t('spo2DetectedMsg') : t('spo2WaitingMsg');
      const spo2Color = hasLiveFinger ? 'var(--ok)' : (hwLive ? '#d97706' : 'var(--mut)');
      const livePulsePreview = (hwLive && hasLiveFinger)
        ? `${HW.spo2 || 98}% SpO2 · ${HW.pulse || 74} BPM`
        : 'Waiting for Pulse...';

      return `
        <h2 data-a="secretTap" style="cursor:pointer; user-select:none;" title="Staff controls">${t('vitalsH')}</h2>
        <p class=hint style="margin-bottom:1vmin">${t('vitalsSub')}</p>

        <div class="vitals-tutorial-box">
          <div class="vitals-recorded-pill">
            <span>[OK] ${t('tempRecorded')}: <b>${S.vitals.temp ?? '--.-'} °F</b></span>
          </div>
          <span class="scanning-step-badge" style="background:#fef3c7; color:#92400e;">${t('step2Badge')}</span>
          <div class="vitals-svg-wrap">${svgSpo2Tutorial}</div>
          <div class="vitals-tutorial-title">${t('step2Title')}</div>
          <div class="vitals-tutorial-desc">${t('step2Desc')}</div>

          <!-- Real-Time ESP32 MAX30100/MAX30102 Pulse Oximeter Status Card -->
          <div class="ultrasonic-meter-card">
            <div class="hw-status-pill ${hwLive ? 'live' : 'wait'}">
              <span class="live-dot-pulse" style="${hwLive ? '' : 'background:#d97706; box-shadow:0 0 0 3px rgba(217,119,6,0.2);'}"></span>
              <span>${hwLabel}</span>
            </div>

            <div class="ultrasonic-header">
              <span class="ultrasonic-title">${t('spo2GuideTitle')}</span>
              <span class="dist-val-badge ${spo2BadgeClass}">
                ${livePulsePreview}
              </span>
            </div>

            <div class="dist-status-text" style="color:${spo2Color};">
              ${spo2StatusTitle}
            </div>
            <div style="font-size:0.8em; color:#475569; margin-bottom:8px;">
              ${spo2StatusMsg}
            </div>

            ${telemetryStripHtml(hwLive)}
          </div>

          ${S.err ? `<div class="err" style="font-size:0.85em; margin-bottom:6px;">${S.err}</div>` : ''}
          <button class="btn-ready-scan locked" data-a="readySpo2">
            ${hasLiveFinger ? t('btnStartSpo2Ready') : t('btnStartSpo2Locked')}
          </button>
        </div>
      `;
    }

    if (S.vitalsStage === 'countdown_spo2') {
      return `
        <h2 data-a="secretTap" style="cursor:pointer; user-select:none;" title="Staff controls">${t('vitalsH')}</h2>
        <p class=hint style="margin-bottom:1vmin">${t('vitalsSub')}</p>

        <div class="vitals-countdown-box">
          <span class="scanning-step-badge" style="background:#fef3c7; color:#92400e;">${t('step2Badge')}</span>
          <div class="countdown-hero-circle" style="border-color:var(--ok); box-shadow:0 0 0 8px rgba(22,163,74,0.12);">
            <span class="countdown-digit" style="color:var(--ok);">${S.countdownSec}</span>
          </div>
          <div class="countdown-submsg">${t('holdStill')} ${S.countdownSec}s...</div>
          <p class="vitals-tutorial-hint" style="margin:4px 0;">${t('measuringSpo2')}</p>
          <div class="countdown-indicator-bar">
            <div class="countdown-indicator-fill" style="width:${(4 - S.countdownSec) * 33.3}%; background:var(--ok);"></div>
          </div>
        </div>
      `;
    }

    return `
      <h2 data-a="secretTap" style="cursor:pointer; user-select:none;" title="Staff controls">${t('vitalsH')}</h2>
      <p class=hint style="margin-bottom:1vmin">${t('vitalsSub')}</p>
      
      <div class="vitals-display-grid">
        <div class="vital-card ${isFever ? 'fever-card' : ''}">
          <span class="vital-label">${t('temp')}</span>
          <div class="vital-value-row">
            <span class="vital-num ${isFever ? 'text-danger' : 'text-primary'}">${v.temp !== null ? v.temp.toFixed(1) : '--.-'}</span>
            <span class="vital-unit">°F</span>
          </div>
          <span class="vital-status-pill ${isFever ? 'pill-danger' : 'pill-ok'}">${isFever ? t('fever') : t('normal')}</span>
        </div>

        <div class="vital-card ${isHypoxia ? 'hypoxia-card' : ''}">
          <span class="vital-label">${t('spo2')}</span>
          <div class="vital-value-row">
            <span class="vital-num ${isHypoxia ? 'text-danger' : (v.spo2 !== null ? 'text-primary' : 'text-mut')}">${v.spo2 !== null ? v.spo2 : '--'}</span>
            <span class="vital-unit">%</span>
          </div>
          <span class="vital-status-pill ${isHypoxia ? 'pill-warn' : (v.spo2 !== null ? 'pill-ok' : 'pill-danger')}">${isHypoxia ? t('hypoxia') : (v.spo2 !== null ? t('optimal') : 'NO READING')}</span>
        </div>

        <div class="vital-card">
          <span class="vital-label">${t('pulse')}</span>
          <div class="vital-value-row">
            <span class="vital-num ${v.pulse !== null ? '' : 'text-mut'}">${v.pulse !== null ? v.pulse : '--'}</span>
            <span class="vital-unit">BPM</span>
          </div>
          <span class="vital-status-pill ${v.pulse !== null ? 'pill-ok' : 'pill-danger'}">${v.pulse !== null ? t('healthy') : 'NO READING'}</span>
        </div>
      </div>

      <div class="vitals-live-sensor-bar">
        <span class="live-dot-pulse"></span>
        <span>${v.live ? (hwLive ? t('hwLiveSensors') : t('scanSensors')) : t('hwFallbackMode')}</span>
      </div>

      <div style="margin-top:0.5vmin;">
        <button class="text-btn" data-a="rescanVitals" style="font-size:0.8em; color:var(--mut);">${t('rescanBtn')}</button>
      </div>

      ${next('toDept', v.temp !== null && v.spo2 !== null)}
    `;
  }

  // Doctor selection step
  if (s === 'dept') {
    return `
      <h2>${t('deptH')}</h2>
      <p class=hint style="margin-bottom:1.5vmin">${t('docSub')}</p>
      <div class="doc-kiosk-grid">
        ${depts.map(d => `
          <div class="doc-kiosk-card ${S.dept === d.id ? 'selected' : ''}" data-d="${d.id}">
            <div class="doc-kiosk-avatar"><span class="doc-initials">${d.initials || d.id}</span></div>
            <div class="doc-kiosk-body">
              <div class="doc-kiosk-name">${d.name}</div>
              <div class="doc-kiosk-spec">${d.specialty[S.lang] || d.specialty.en}</div>
              <div class="doc-kiosk-chips">
                <span class="badge room">${d.room}</span>
                <span class="badge wait">Wait: ${d.waitCount} · ~${d.avgWaitMinutes} ${t('min')}</span>
              </div>
              <div class="doc-kiosk-serving"><b>${t('now')}:</b> ${d.nowServing}</div>
            </div>
          </div>
        `).join('')}
      </div>
      ${next('toSym', !!S.dept)}
    `;
  }

  if (s === 'sym') {
    return `
      <h2>${t('symH')}</h2>
      <div class=chips>
        ${Object.keys(T.en.s).map(k => `
          <button class="${S.sym.includes(k) ? 'on' : ''}" data-s="${k}">${t('s')[k]}</button>
        `).join('')}
      </div>
      ${S.sym.includes('Chest pain') ? `<div class=warn style="font-weight:700">[URGENT] ${t('chest')}</div>` : ''}
      ${next('toConsent', true)}
    `;
  }

  if (s === 'consent') {
    return `
      <h2>${t('consentH')}</h2>
      <div class=card><p style="color:var(--ink)">${t('consentT')}</p></div>
      <button data-a=agree>${t('agree')}</button>
    `;
  }

  if (s === 'pager') {
    return `
      <h2>${t('pagerH')}</h2>
      <div class=tok>${S.tok ? S.tok.pagerId : '…'}</div>
      <p style="max-width:800px">${t('pagerT')}</p>
      <p class=ok>${S.busy ? '…' : t('conn')}</p>
      ${next('toToken', !S.busy)}
    `;
  }

  if (s === 'token') {
    const k = S.tok;
    return `
      <div class=slip>
        <h2>${t('tokenH')}</h2>
        <div class=tok>${k.token}</div>
        <h2>${k.doctorName} · ${k.room}</h2>
        <p>${k.position} ${t('ahead')} · ${t('eta')}: ~${k.etaMinutes} ${t('min')}</p>
        ${k.isEmergency ? `<div class="warn" style="font-weight:700;margin-top:10px">CRITICAL / EMERGENCY PRIORITY</div>` : ''}
      </div>
      <div id=qr></div>
      <p class=hint>${t('scan')}</p>
      <div class=row><button data-a=done>${t('done')} (${S.left})</button></div>
    `;
  }
}

function draw() {
  $.innerHTML = screen() + (['standby', 'lang', 'token'].includes(S.step) ? '' : foot()) + renderSecretMenu() + `<div data-a="secretTap" style="position:fixed;top:0;right:0;width:56px;height:56px;z-index:9000;cursor:pointer;" title="Hardware Diagnostics"></div>`;
  if (S.step === 'token' && S.tok) {
    try {
      const q = qrcode(0, 'M');
      q.addData(S.tok.patientUrl);
      q.make();
      document.getElementById('qr').innerHTML = q.createSvgTag({ cellSize: 5, margin: 2 });
    } catch (e) {
      console.error('QR Gen error:', e);
    }
  }
}

let vitalsCountdownTimer = null;
const stopVitalsTimers = () => {
  if (vitalsCountdownTimer) {
    clearInterval(vitalsCountdownTimer);
    vitalsCountdownTimer = null;
  }
};

const startTempCountdown = () => {
  stopVitalsTimers();
  S.err = '';
  S.vitalsStage = 'countdown_temp';
  S.countdownSec = 3;
  draw();
  playTone(520, 0.1);
  notifyEspKioskStage('temp_scan', '3');

  vitalsCountdownTimer = setInterval(() => {
    S.countdownSec--;
    if (S.countdownSec > 0) {
      playTone(520, 0.1);
      notifyEspKioskStage('temp_scan', String(S.countdownSec));
      draw();
    } else {
      clearInterval(vitalsCountdownTimer);
      vitalsCountdownTimer = null;
      const rawT = isHwLive() ? HW.temp : null;
      const tpVal = (rawT !== null && rawT !== undefined && rawT >= 70 && rawT <= 115) ? rawT : 98.6;
      const tp = +(parseFloat(tpVal).toFixed(1));
      S.vitals.temp = tp;
      S.vitals.live = isHwLive();
      S.vitals.isFever = tp >= 100.4;
      if (S.vitals.isFever && !S.sym.includes('Fever')) S.sym.push('Fever');
      playTone(660, 0.15);
      setTimeout(() => playTone(880, 0.25), 150);
      notifyEspKioskStage('temp_ok', String(tp));
      setTimeout(() => notifyEspKioskStage('tutorial_spo2'), 300);
      S.vitalsStage = 'tutorial_spo2';
      draw();
    }
  }, 1000);
};

const startSpo2Countdown = () => {
  stopVitalsTimers();
  S.vitalsStage = 'countdown_spo2';
  S.countdownSec = 8; // Full clinical PPG optical settling window (6-10s)
  draw();
  playTone(520, 0.1);
  notifyEspKioskStage('spo2_scan', '8');

  vitalsCountdownTimer = setInterval(() => {
    S.countdownSec--;
    if (S.countdownSec > 0) {
      playTone(520, 0.1);
      notifyEspKioskStage('spo2_scan', String(S.countdownSec));
      draw();
    } else {
      clearInterval(vitalsCountdownTimer);
      vitalsCountdownTimer = null;
      const hwOnline = isHwLive();
      const rawOx = hwOnline ? HW.spo2 : null;
      const rawHr = hwOnline ? HW.pulse : null;
      const hasRealReading = (rawOx !== null && rawOx !== undefined && rawOx >= 60 && rawOx <= 100);
      const ox = hasRealReading ? parseInt(rawOx, 10) : null;
      const hr = (hasRealReading && rawHr !== null && rawHr !== undefined && rawHr >= 40 && rawHr <= 200) ? parseInt(rawHr, 10) : null;

      S.vitals.spo2 = ox;
      S.vitals.pulse = hr;
      S.vitals.live = hwOnline;
      S.vitals.isHypoxia = (ox !== null) && (ox < 94);
      if (ox !== null) {
        playTone(700, 0.15);
        setTimeout(() => playTone(950, 0.3), 150);
        notifyEspKioskStage('spo2_ok', `${ox}|${hr}`);
        S.vitalsStage = 'ready';
      } else {
        S.err = 'No finger detected on sensor. Place finger firmly on sensor.';
        playTone(260, 0.14);
        S.vitalsStage = 'tutorial_spo2';
      }
      draw();
    }
  }, 1000);
};

const startVitalsIntake = () => {
  stopVitalsTimers();
  S.err = '';
  S.distanceCm = isHwLive() ? HW.dist : null;
  S.vitals = { temp: null, spo2: null, pulse: null, isFever: false, isHypoxia: false, live: isHwLive() };
  S.vitalsStage = 'tutorial_temp';
  S.countdownSec = 3;
  notifyEspKioskStage('align', S.distanceCm !== null ? String(S.distanceCm) : '');
  draw();
};

const go = s => {
  stopVitalsTimers();
  S.step = s;
  S.err = '';
  notifyEspKioskStage(s === 'vitals' ? 'align' : s);
  if (s === 'vitals') {
    startVitalsIntake();
  } else {
    draw();
  }
};
const reset = l => {
  stopVitalsTimers();
  clearInterval(tmr);
  notifyEspKioskStage('standby');
  const keepUnlocked = S ? S.secretStaffUnlocked : false;
  const keepPir = S ? (S.pirWakeEnabled !== false) : true;
  S = fresh(l);
  S.secretStaffUnlocked = keepUnlocked;
  S.pirWakeEnabled = keepPir;
  draw();
};

function speak() {
  try {
    const u = new SpeechSynthesisUtterance(S.tok.token.replace('-', ' ') + (S.lang === 'hi' ? ' आपका टोकन' : ' is your token'));
    u.lang = S.lang === 'hi' ? 'hi-IN' : 'en-IN';
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  } catch (e) {}
}

const countdown = (n, cb) => {
  clearInterval(tmr);
  S.left = n;
  tmr = setInterval(() => {
    S.left--;
    if (S.left <= 0) {
      clearInterval(tmr);
      cb();
    }
    if (['otp', 'token'].includes(S.step)) draw();
  }, 1000);
};

const A = {
  connectUsb: async () => {
    await connectWebSerial(true);
    draw();
  },
  wake: () => {
    if (S.step !== 'standby') return;
    S.step = 'lang';
    playTone(660, 0.15);
    setTimeout(() => playTone(880, 0.25), 150);
    draw();
    poke();
  },
  en: () => { S.lang = 'en'; go('name'); },
  hi: () => { S.lang = 'hi'; go('name'); },
  lang: () => { S.lang = S.lang === 'en' ? 'hi' : 'en'; draw(); },
  back: () => go(nav[S.step] || 'lang'),
  sos: () => {
    SOS.innerHTML = `
      <div class=card>
        <h1 style="color:var(--red)">${t('emerg')}</h1>
        <p>${t('emergQ')}</p>
        <div class=row>
          <button style="background:var(--red)" data-a=sosyes>${t('emerg')}</button>
          <button class=alt data-a=sosno>${t('cancel')}</button>
        </div>
      </div>
    `;
    SOS.className = 'on';
  },
  sosno: () => { SOS.className = ''; },
  sosyes: async () => {
    await raiseEmergency({ kioskId: 'K1' });
    SOS.innerHTML = `
      <div class=card>
        <h1 style="color:var(--red)">${t('emergT')}</h1>
        <p style="margin:2vmin 0;color:var(--red);font-weight:700">[ALARM] ESP32 Buzzer &amp; Siren Activated</p>
        <button data-a=sosdone style="background:var(--ok)">${t('ok')} · Silence Buzzer</button>
      </div>
    `;
  },
  sosdone: () => {
    resolveEmergency({ kioskId: 'K1' });
    SOS.className = '';
    reset(S.lang);
  },
  send: async () => {
    S.busy = true; draw();
    const r = await sendOtp(S.phone);
    S.busy = false;
    if (!r.ok) { S.err = t('e10'); return draw(); }
    S.otp = ''; go('otp');
    countdown(r.resendInSeconds, () => { S.left = 0; draw(); });
  },
  resend: async () => {
    const r = await sendOtp(S.phone);
    countdown(r.resendInSeconds, () => { S.left = 0; draw(); });
  },
  change: () => {
    clearInterval(tmr); S.phone = ''; S.otp = ''; S.left = 0; go('phone');
  },
  verify: async () => {
    S.busy = true; draw();
    const r = await verifyOtp(S.phone, S.otp);
    S.busy = false;
    clearInterval(tmr);
    S.left = 0;
    if (!r.verified) { S.err = t('e4'); S.otp = ''; return draw(); }
    if (r.patient) { S.known = r.patient; go('ask'); } else go('name');
  },
  yes: () => { S.name = S.known.name; S.age = S.known.age; go('vitals'); },
  no: () => go('name'),
  toAge: () => go('age'),
  toVitals: () => go('vitals'),
  startTempScan: () => { startTempCountdown(); },
  setDist: d => {
    S.distanceCm = d;
    S.err = '';
    notifyEspKioskStage('align', String(d));
    draw();
  },
  readyTemp: () => {
    const distInfo = evalDistance(S.distanceCm);
    if (!distInfo.inTarget && S.distanceCm !== null && (S.distanceCm < 3 || S.distanceCm > 5)) {
      S.err = t('distLockRequired');
      playTone(260, 0.14);
      draw();
      return;
    }
    S.err = '';
    startTempCountdown();
  },
  startSpo2Scan: () => {
    S.err = '';
    startSpo2Countdown();
  },
  readySpo2: () => {
    S.err = '';
    startSpo2Countdown();
  },
  rescanVitals: () => {
    startVitalsIntake();
  },
  secretTap: () => {
    const now = Date.now();
    if (now - (S.lastSecretTapTime || 0) < 1500) {
      S.secretTapCount = (S.secretTapCount || 0) + 1;
    } else {
      S.secretTapCount = 1;
    }
    S.lastSecretTapTime = now;
    if (S.secretTapCount >= 3) {
      S.secretStaffUnlocked = !S.secretStaffUnlocked;
      S.secretTapCount = 0;
    }
    draw();
  },
  toggleSecretMenu: () => {
    S.secretStaffUnlocked = !S.secretStaffUnlocked;
    draw();
  },
  hideSecretMenu: () => {
    S.secretStaffUnlocked = false;
    draw();
  },
  devTogglePir: () => {
    S.pirWakeEnabled = S.pirWakeEnabled === false ? true : false;
    draw();
  },
  devTriggerMotion: () => {
    playTone(720, 0.12);
    if (S.step === 'standby') {
      A.wake();
    } else {
      draw();
    }
  },
  devEnterStandby: () => {
    stopVitalsTimers();
    reset();
  },
  toDept: () => go('dept'),
  toSym: () => go('sym'),
  toConsent: () => go('consent'),
  agree: async () => {
    S.busy = true; go('pager');
    const isEmerg = S.sym.includes('Chest pain');
    S.tok = await createToken({
      name: S.name,
      age: S.age,
      phone: S.phone,
      phoneVerified: true,
      doctorId: S.dept,
      departmentId: S.dept,
      symptoms: S.sym,
      vitals: S.vitals,
      isEmergency: isEmerg,
      language: S.lang,
      consent: { data: true, face: false }
    });
    setTimeout(() => { S.busy = false; draw(); }, 1800);
    draw();
  },
  toToken: () => {
    notifyEspKioskStage('token', S.tok?.token || '');
    go('token');
    speak();
    countdown(60, () => reset());
  },
  done: () => reset()
};

const FIELD = { phone: ['phone', 10], otp: ['otp', 4], name: ['name', 24], age: ['age', 3] };

$.addEventListener('click', async e => {
  // 1. Overlay backdrop click or close button
  if (e.target.dataset.a === 'overlayClose' || e.target.closest('[data-a="hideSecretMenu"]')) {
    A.hideSecretMenu();
    return;
  }

  // 2. Secret staff tap trigger (heading or corner zone)
  const secretTapEl = e.target.closest('[data-a="secretTap"]');
  if (secretTapEl) {
    A.secretTap();
    return;
  }

  // 3. Secret modal internal button actions
  const secretBtn = e.target.closest('.secret-staff-modal button, .secret-staff-panel button');
  if (secretBtn && secretBtn.dataset.a) {
    if (secretBtn.dataset.a === 'setDist') {
      A.setDist(parseInt(secretBtn.dataset.dist || '4', 10));
    } else if (secretBtn.dataset.a === 'setSpo2Fallback') {
      A.setSpo2Fallback();
    } else if (A[secretBtn.dataset.a]) {
      A[secretBtn.dataset.a]();
    }
    return;
  }

  if (S.step === 'standby') {
    const sosBtn = e.target.closest('[data-a="sos"]');
    if (sosBtn) {
      A.sos();
      return;
    }
    A.wake();
    return;
  }

  const b = e.target.closest('button');
  const dEl = e.target.closest('[data-d]');

  if (dEl) {
    S.dept = dEl.dataset.d;
    draw();
    return;
  }

  if (!b) return;

  if (b.dataset.k !== undefined) {
    const f = FIELD[S.step];
    if (!f) return;
    let v = S[f[0]], k = b.dataset.k;
    v = k === '⌫' ? v.slice(0, -1) : k === 'C' ? '' : (v + k).slice(0, f[1]);
    if (f[0] === 'name') v = v.replace(/^ +/, '').replace(/ {2,}/g, ' ');
    S[f[0]] = v;
    S.err = '';
    draw();
    if (S.step === 'otp' && v.length === 4) A.verify();
  } else if (b.dataset.s) {
    const k = b.dataset.s;
    S.sym = S.sym.includes(k) ? S.sym.filter(x => x !== k) : [...S.sym, k];
    draw();
  } else if (b.dataset.a === 'setDist') {
    A.setDist(parseInt(b.dataset.dist || '4', 10));
  } else if (b.dataset.a === 'setSpo2Fallback') {
    A.setSpo2Fallback();
  } else if (b.dataset.a && A[b.dataset.a]) {
    A[b.dataset.a]();
  }
});

document.body.addEventListener('click', e => {
  const b = e.target.closest('button');
  if (b && b.closest('#sos') && A[b.dataset.a]) A[b.dataset.a]();
});

document.querySelector('.fab,#app') && document.body.addEventListener('click', e => {
  const b = e.target.closest('.fab');
  if (b && A[b.dataset.a]) A[b.dataset.a]();
});

// Full Physical Keyboard Navigation & Typing Support for Kiosk
window.addEventListener('keydown', e => {
  // If secret modal is open, Escape, O, or ~ closes it
  if (S.secretStaffUnlocked && (e.key === 'Escape' || e.key === 'o' || e.key === 'O' || e.key === '`' || e.key === '~')) {
    e.preventDefault();
    A.hideSecretMenu();
    return;
  }

  // Hidden Dev Menu Hotkey (Backtick ` or Tilde ~ or 'o'/'O')
  if (e.key === '`' || e.key === '~' || ((e.key === 'o' || e.key === 'O') && S.step !== 'name')) {
    if (e.target && ['INPUT', 'TEXTAREA'].includes(e.target.tagName)) return;
    e.preventDefault();
    A.toggleSecretMenu ? A.toggleSecretMenu() : A.secretTap();
    return;
  }

  if (e.repeat && ['Enter', 'Escape'].includes(e.key)) return;

  // Handle active SOS modal
  if (SOS.className === 'on') {
    if (e.key === 'Escape') {
      A.sosno();
      return;
    }
    if (e.key === 'Enter') {
      const sosBtn = SOS.querySelector('button[data-a]');
      if (sosBtn && A[sosBtn.dataset.a]) A[sosBtn.dataset.a]();
      return;
    }
    return;
  }

  const s = S.step;

  if (s === 'standby') {
    if (e.key === 'Escape') return;
    A.wake();
    return;
  }

  // 1. Language Selection Screen
  if (s === 'lang') {
    if (e.key === '1' || e.key.toLowerCase() === 'e') {
      A.en();
      return;
    }
    if (e.key === '2' || e.key.toLowerCase() === 'h') {
      A.hi();
      return;
    }
    if (e.key === 'Enter') {
      A.en();
      return;
    }
  }

  // 2. Name Entry Screen
  if (s === 'name') {
    if (e.key === 'Enter') {
      if (S.name.trim().length > 1) A.toAge();
      return;
    }
    if (e.key === 'Backspace') {
      if (S.name.length > 0) {
        S.name = S.name.slice(0, -1);
        draw();
      } else {
        A.back();
      }
      return;
    }
    if (e.key === ' ' || /^[a-zA-Z]$/.test(e.key)) {
      if (S.name.length < 24) {
        let v = (S.name + e.key.toUpperCase()).replace(/^ +/, '').replace(/ {2,}/g, ' ');
        S.name = v;
        S.err = '';
        draw();
      }
      return;
    }
  }

  // 3. Age Entry Screen
  if (s === 'age') {
    if (e.key === 'Enter') {
      if (+S.age > 0 && +S.age < 120) A.toVitals();
      return;
    }
    if (e.key === 'Backspace') {
      if (S.age.length > 0) {
        S.age = S.age.slice(0, -1);
        draw();
      } else {
        A.back();
      }
      return;
    }
    if (/^[0-9]$/.test(e.key)) {
      if (S.age.length < 3) {
        S.age += e.key;
        S.err = '';
        draw();
      }
      return;
    }
  }

  // 3b. Vitals Screen
  if (s === 'vitals') {
    if (e.key === 'Enter') {
      if (S.vitalsStage === 'tutorial_temp') {
        A.readyTemp();
        return;
      }
      if (S.vitalsStage === 'tutorial_spo2') {
        A.readySpo2();
        return;
      }
      if (S.vitalsStage === 'ready') {
        if (S.vitals.temp !== null && S.vitals.spo2 !== null) A.toDept();
        return;
      }
      return;
    }
    if (e.key === '1' && S.secretStaffUnlocked) {
      A.presetNormal();
      return;
    }
    if (e.key === '2' && S.secretStaffUnlocked) {
      A.presetFever();
      return;
    }
    if (e.key === '3' && S.secretStaffUnlocked) {
      A.presetHypoxia();
      return;
    }
    if (e.key === 's' || e.key === 'S') {
      A.secretTap();
      return;
    }
    if (e.key === 'r' || e.key === 'R') {
      A.rescanVitals();
      return;
    }
    if (e.key === 'Backspace' || e.key === 'Escape') {
      A.back();
      return;
    }
  }

  // 4. Doctor Selection Screen
  if (s === 'dept') {
    if (e.key === '1' && depts[0]) {
      S.dept = depts[0].id;
      draw();
      return;
    }
    if (e.key === '2' && depts[1]) {
      S.dept = depts[1].id;
      draw();
      return;
    }
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key) && depts.length > 1) {
      S.dept = S.dept === depts[0].id ? depts[1].id : depts[0].id;
      draw();
      return;
    }
    if (e.key === 'Enter') {
      if (S.dept) A.toSym();
      return;
    }
    if (e.key === 'Backspace' || e.key === 'Escape') {
      A.back();
      return;
    }
  }

  // 5. Symptoms Screen
  if (s === 'sym') {
    const symKeys = Object.keys(T.en.s);
    if (/^[1-9]$/.test(e.key)) {
      const idx = parseInt(e.key, 10) - 1;
      if (idx < symKeys.length) {
        const k = symKeys[idx];
        S.sym = S.sym.includes(k) ? S.sym.filter(x => x !== k) : [...S.sym, k];
        draw();
        return;
      }
    }
    if (e.key === 'Enter') {
      A.toConsent();
      return;
    }
    if (e.key === 'Backspace' || e.key === 'Escape') {
      A.back();
      return;
    }
  }

  // 6. Consent Screen
  if (s === 'consent') {
    if (e.key === 'Enter' || e.key.toLowerCase() === 'y') {
      A.agree();
      return;
    }
    if (e.key === 'Backspace' || e.key === 'Escape') {
      A.back();
      return;
    }
  }

  // 7. Pager Screen
  if (s === 'pager') {
    if (e.key === 'Enter' && !S.busy) {
      A.toToken();
      return;
    }
  }

  // 8. Token Screen
  if (s === 'token') {
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape') {
      A.done();
      return;
    }
  }

  // 9. Phone Screen (if enabled)
  if (s === 'phone') {
    if (e.key === 'Enter') {
      if (S.phone.length === 10 && !S.busy) A.send();
      return;
    }
    if (e.key === 'Backspace') {
      if (S.phone.length > 0) {
        S.phone = S.phone.slice(0, -1);
        draw();
      } else {
        A.back();
      }
      return;
    }
    if (/^[0-9]$/.test(e.key) && S.phone.length < 10) {
      S.phone += e.key;
      draw();
      return;
    }
  }

  // 10. OTP Screen (if enabled)
  if (s === 'otp') {
    if (e.key === 'Backspace') {
      S.otp = S.otp.slice(0, -1);
      draw();
      return;
    }
    if (/^[0-9]$/.test(e.key) && S.otp.length < 4) {
      S.otp += e.key;
      draw();
      if (S.otp.length === 4) A.verify();
      return;
    }
  }

  // 11. Known patient confirmation
  if (s === 'ask') {
    if (e.key === 'Enter' || e.key.toLowerCase() === 'y') {
      A.yes();
      return;
    }
    if (e.key.toLowerCase() === 'n' || e.key === 'Escape') {
      A.no();
      return;
    }
  }
});

const poke = () => {
  clearTimeout(idle);
  idle = setTimeout(() => {
    if (S.step !== 'standby') {
      SOS.className = '';
      reset(S.lang);
    }
  }, 45000);
};
['pointerdown', 'keydown'].forEach(v => addEventListener(v, poke));
addEventListener('contextmenu', e => e.preventDefault());

window.addEventListener('triageq_vitals_update', e => {
  const d = e.detail;
  if (!d) return;
  const wasLive = isHwLive();

  const motion = (d.motion === 1 || d.motion === true || d.motion === '1') ? 1 : 0;
  if (motion === 1) {
    HW.motion = 1;
    HW.motionAt = Date.now();
    if (S && S.step === 'standby') {
      if (S.pirWakeEnabled !== false) {
        A.wake();
        return;
      }
    }
  } else if (d.motion !== undefined) {
    HW.motion = 0;
  }

  const tp = d.temp !== undefined && d.temp !== null && !isNaN(parseFloat(d.temp))
    ? +(parseFloat(d.temp).toFixed(1))
    : HW.temp;
  const rawOx = (d.spo2 !== undefined && d.spo2 !== null && !isNaN(parseInt(d.spo2, 10)))
    ? parseInt(d.spo2, 10)
    : null;
  const ox = (rawOx !== null && rawOx > 0) ? rawOx : null;

  const rawHr = (d.pulse !== undefined && d.pulse !== null && !isNaN(parseInt(d.pulse, 10)))
    ? parseInt(d.pulse, 10)
    : null;
  const hr = (rawHr !== null && rawHr > 0) ? rawHr : null;
  const dist = d.dist !== undefined && d.dist !== null && !isNaN(parseInt(d.dist, 10))
    ? parseInt(d.dist, 10)
    : HW.dist;

  const isFinger = d.finger === true || d.finger === 'true' || (ox !== null && ox > 0);
  const fingerChanged = (HW.finger !== isFinger);

  HW.connected = true;
  HW.lastAt = Date.now();
  HW.temp = tp;
  HW.spo2 = ox;
  HW.pulse = hr;
  HW.dist = dist;
  HW.finger = isFinger;
  if (d.ir !== undefined && d.ir !== null) HW.ir = parseInt(d.ir, 10);
  if (d.red !== undefined && d.red !== null) HW.red = parseInt(d.red, 10);

  if (!S) return;
  S.liveSensorBuffer = { temp: tp, spo2: ox, pulse: hr, dist: dist };

  let shouldRedraw = !wasLive || fingerChanged;
  if (dist !== null) {
    if (S.distanceCm !== dist) shouldRedraw = true;
    S.distanceCm = dist;
    S.manualFallbackDist = false;
    if (S.vitalsStage === 'tutorial_temp' && dist >= 3 && dist <= 5 && S.err) {
      S.err = '';
      shouldRedraw = true;
    }
  }
  if (S.vitalsStage === 'tutorial_spo2' && ox !== null && S.err === t('fingerRequired')) {
    S.err = '';
    shouldRedraw = true;
  }

  if (S.secretStaffUnlocked) {
    draw();
    return;
  }

  if (S.step === 'vitals' && (S.vitalsStage === 'tutorial_temp' || S.vitalsStage === 'tutorial_spo2')) {
    draw();
    return;
  }

  // Keep recorded readings responsive to live sensor changes (without wiping SpO2 if finger lifts)
  if (S.step === 'vitals' && S.vitalsStage === 'ready' && S.vitals?.live !== false) {
    const nextTemp = tp !== null ? tp : S.vitals.temp;
    const nextOx = ox !== null ? ox : S.vitals.spo2;
    const nextHr = hr !== null ? hr : S.vitals.pulse;
    S.vitals = {
      temp: nextTemp,
      spo2: nextOx,
      pulse: nextHr,
      isFever: nextTemp !== null && nextTemp >= 100.4,
      isHypoxia: nextOx !== null && nextOx < 94,
      live: true
    };
    if (S.vitals.isFever && !S.sym.includes('Fever')) {
      S.sym.push('Fever');
    }
    draw();
  } else if (shouldRedraw && S.step === 'vitals') {
    draw();
  }
});

(async () => {
  initMqtt();
  try {
    connectWebSerial(false);
  } catch (e) {}
  window.addEventListener('triageq_serial_status', () => {
    draw();
  });
  depts = await getDoctors();
  S = fresh();
  sum = await getQueueSummary();
  draw();
  poke();

  onQueueUpdate(async () => {
    depts = await getDoctors();
    sum = await getQueueSummary();
    if (['lang', 'dept'].includes(S.step)) draw();
  });

  setInterval(() => {
    if (HW.connected && !isHwLive()) {
      HW.connected = false;
      if (S && !S.manualFallbackDist) {
        S.distanceCm = null;
      }
      if (S && S.step === 'vitals') draw();
    }
  }, 2500);

  setInterval(async () => {
    sum = await getQueueSummary();
    depts = await getDoctors();
    if (['standby', 'lang'].includes(S.step)) draw();
  }, 5000);
})();

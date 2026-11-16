# MediCore Clinic Smart Kiosk System

A comprehensive hospital triage and queue management system comprising a Touchscreen Kiosk, Doctor Dashboard, Patient Mobile Tracker, and ESP32 Clinical Node & Emergency Alarm.

---

## How to Run

Run a local server from the project directory:

```bash
# Using Python
python3 -m http.server 3000

# OR using Node
npx serve .
```

Then access the three portals:

1. **Kiosk Interface:** [https://med-kiosk.vercel.app](https://med-kiosk.vercel.app)
2. **Doctor Dashboard:** [https://med-kiosk.vercel.app/doctor](https://med-kiosk.vercel.app/doctor)
3. **Patient Mobile Tracker:** [https://med-kiosk.vercel.app/patient](https://med-kiosk.vercel.app/patient) *(or scanned via QR code on Kiosk)*

---

## Doctor Credentials & Security PINs

| Doctor Name | Department & Room | Security PIN |
|---|---|---|
| **Dr. Gaurav Sharma** | General & Internal Medicine · Room 101 | `1111` |
| **Dr. Priya Sharma** | Pediatrics & Family Care · Room 102 | `2222` |

---

## Live Queue & Portals Flow

1. **Kiosk Registration (`index.html`):**
   - Language selection (English / हिन्दी).
   - Mobile verification (Demo OTP bypass: any 10-digit number & any 4-digit OTP).
   - Patient Name & Age entry.
   - **Patient-Paced Guided Vitals Intake:**
     - **Step 1 (Body Temperature & Ultrasonic Alignment Interlock):** Real-time ultrasonic alignment guide (HC-SR04) measuring distance to patient forehead (Too Far > 5cm, Too Close < 3cm, Out of Range > 15cm, Perfect 3-5cm) + automated distance lock-on + 3-2-1 audio countdown + MLX90614 infrared temperature scan.
     - **Step 2 (Blood Oxygen & Pulse):** Visual guide on placing index fingertip on the optical pulse oximeter (MAX30102) + **"I Am Ready — Measure SpO2"** button + 3-2-1 countdown with pulse audio tone.
     - **Step 3 (Vitals Summary):** Displays Body Temperature, SpO2 %, and Heart Rate with clinical alert tags (Fever &ge; 100.4&deg;F, Hypoxia &lt; 94%) and a "Re-take Measurement" option.
     - **Secret Staff / Examiner Menu:** Triple-tap the screen header title to reveal hidden presets for fast viva demonstration (Normal, High Fever, Hypoxia Alert, Re-scan). Normal patients see only the clean clinical flow. Flags patients with fever (&ge; 100.4&deg;F) or hypoxia (&lt; 94% SpO2) for priority triage.
   - **Direct Doctor Selection:** Choose between **Dr. Gaurav Sharma** and **Dr. Priya Sharma**.
   - Symptoms selection (selecting *Chest pain* flags emergency priority).
   - Privacy consent & pager pickup.
   - **Token & QR Code Slip:** Displays token (`GS-001` or `PS-001`) and generates a dynamic QR code pointing to `patient.html?token=...`.

2. **Doctor Console (`doctor.html`):**
   - Select doctor profile and enter 4-digit PIN.
   - **Active Consultation Card:** View patient details, consultation timer, and click **"Consultation Completed"** or **"Next Patient"**.
   - **Emergency Patient Banner:** If a patient is flagged critical, a high-priority alert appears with a 1-click **"Call Emergency Patient Now"** override.
   - **Waiting Queue:** Real-time queue list of patients with symptoms and wait times.
   - **ESP32 Siren Control:** One-click buzzer silence.

3. **Patient Mobile Tracker (`patient.html`):**
   - Automatically loaded by scanning the Kiosk QR code (or by entering token).
   - Real-time live status:
     - **In Queue:** Shows exact number of patients ahead and estimated wait time.
     - **Your Turn:** Pulsing alert, chime, and device vibration when called by the doctor.
     - **Completed:** Consultation wrap-up notice.
   - **Mobile SOS Button:** Alerts doctor and activates the ESP32 emergency siren if the patient feels worse in the waiting hall.

4. **ESP32 Token Display, Buzzer & Siren (`wokwi/`):**
   - 20x4 I2C LCD Token Calling Display: Shows real-time Token, Doctor Name, and Room Number.
   - Dual-broker MQTT integration (`broker.emqx.io` / `broker.hivemq.com`).
   - Listens on `triageq/kiosk/emergency` for `CALL:`, `DONE:`, `EMERGENCY_ON`, and `EMERGENCY_OFF`.
   - Test in Wokwi simulator following [`wokwi/README.md`](wokwi/README.md).

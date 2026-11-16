# TriageQ Smart Clinic - ESP32 Token Call Display & Emergency Node

This node controls the physical / simulated clinical hardware:
1. **20x4 I2C LCD Token Display:** High-visibility clinical token announcement screen showing Doctor Name, Room Number, Token ID, and Patient Call Status.
2. **Hospital Ding-Dong Chime:** Plays a pleasant two-tone hospital arrival chime (784Hz -> 1046Hz) when a patient is called.
3. **Hospital Emergency Siren:** Dual-tone (2200Hz / 1400Hz) alarm + flashing red LED + LCD Code Red alert when an emergency is reported (Kiosk SOS, Patient phone SOS, or Chest pain).
4. **Physical Kiosk SOS Pushbutton:** Pressing the red button on the hardware immediately broadcasts `EMERGENCY_ON` to the Kiosk and Doctor dashboard!
5. **Physical Stop Buzzer Pushbutton:** Pressing the green button on the hardware immediately silences the siren locally and broadcasts `EMERGENCY_OFF` to all portals!

---

## Hardware Wiring Diagram

| Component | Pin on ESP32 | Description |
|---|---|---|
| **I2C LCD Display (SDA)** | **GPIO 21** | I2C Serial Data |
| **I2C LCD Display (SCL)** | **GPIO 22** | I2C Serial Clock |
| **I2C LCD Display (VCC)** | **5V** (or 3.3V) | Power supply |
| **I2C LCD Display (GND)** | **GND** | Ground |
| **Piezo Buzzer (+)** | **GPIO 18** | Positive signal pin |
| **Piezo Buzzer (-)** | **GND** | Ground |
| **Red Alarm LED (Anode +)** | **GPIO 2** | Connected via 220 Ohm resistor |
| **Red Alarm LED (Cathode -)** | **GND** | Ground |
| **Physical Red SOS Pushbutton** | **GPIO 13** &bull; **GND** | Push to ground (Uses internal `INPUT_PULLUP`) |
| **Physical Green Stop Button** | **GPIO 14** &bull; **GND** | Push to ground (Uses internal `INPUT_PULLUP`) |
| **Wokwi NTC Temperature Sensor** | **OUT: GPIO 34** &bull; **3V3** &bull; **GND** | Simulated body temperature (`Beta 3950`, slider in &deg;C converted to &deg;F for `MLX90614` slot) |
| **SpO2 / Pulse Mode Slide Switch** | **Common Pin 2: GPIO 26** &bull; **Pin 3: GND** | Simulated `MAX30102` state (`HIGH` = Normal `98% / 74 BPM`, `LOW` = Alert `89% / 108 BPM`) |
| **Ultrasonic Alignment Sensor (`HC-SR04`)** | **TRIG: GPIO 5** &bull; **ECHO: GPIO 19** &bull; **5V** &bull; **GND** | Live distance telemetry (`1 - 99 cm`, locks Kiosk Step 1 at `3 - 5 cm`) |
| **PIR Motion Sensor (`HC-SR501`)** | **OUT: GPIO 27** &bull; **5V** &bull; **GND** | Patient proximity wake (wakes Kiosk from idle Standby to language screen) |

---

## Wokwi Simulation Controls (Zero Potentiometers)

Because Wokwi does not include built-in `MLX90614` or `MAX30102` parts without custom C/WASM chips, the simulator uses 4 built-in clickable controls so your whole team can test the complete Kiosk pipeline immediately:

1. **Body Temperature (`wokwi-ntc-temperature-sensor` on `GPIO 34`):** Click the NTC temperature board while running and drag its **Temperature (°C)** slider (e.g., `37.0°C` &rarr; `98.6°F`, `38.9°C` &rarr; `102.0°F` fever).
2. **SpO2 & Pulse Mode (`wokwi-slide-switch` on `GPIO 26`):** Toggle the slide switch between **Normal (`98%` SpO2 / `74` BPM)** and **Low-O2 Alert (`89%` SpO2 / `108` BPM)**.
3. **Ultrasonic Distance (`wokwi-hc-sr04` on `GPIO 5 / 19`):** Click the ultrasonic sensor and drag the distance slider (`3 - 5 cm` unlocks Kiosk Step 1 temperature capture).
4. **PIR Motion Sensor (`wokwi-pir-motion-sensor` on `GPIO 27`):** Click the PIR sensor while running &rarr; motion triggers, instantly waking the Kiosk from the screensaver idle screen to the English / Hindi intake screen.
5. **20x4 I2C LCD (`0x27`):** Displays live 4-sensor telemetry when idle, and switches to **NOW CALLING** or **CODE RED** alerts on MQTT events.

---

## How to Run in Wokwi Simulator

1. Go to: **[https://wokwi.com/projects/new/esp32](https://wokwi.com/projects/new/esp32)**.
2. In the **`diagram.json`** tab, paste the code from [`wokwi/diagram.json`](./diagram.json).  
   *(You will see the Kiosk SOS button, Stop Buzzer button, Emergency LED, Resistor, Buzzer, NTC Temperature Sensor, SpO2 Mode Switch, HC-SR04 Ultrasonic Sensor, PIR Motion Sensor, ESP32 DevKit, and 20x4 LCD Display.)*
3. In the **`libraries.txt`** tab, add:
   ```
   PubSubClient
   LiquidCrystal_I2C
   ```
4. In the **`sketch.ino`** tab, paste the code from [`wokwi/sketch.ino`](./sketch.ino).
5. Click the green **Play (Start Simulation)** button.
6. The LCD initializes, connects to HiveMQ, and enters the standby token display:
   ```
   === TRIAGEQ CLINIC =
   98.6F 98% 4cm       
   PIR: WATCHING IDLE  
   RM 101: DR. GAURAV  
   ```

---

## Testing with Live System

Open the live clinic portal:
* **Live Kiosk:** [https://med-kiosk.vercel.app](https://med-kiosk.vercel.app)
* **Doctor Console:** [https://med-kiosk.vercel.app/doctor](https://med-kiosk.vercel.app/doctor) *(PIN: `1111` for Dr. Gaurav Sharma or `2222` for Dr. Priya Sharma)*

### Test 1: Call Patient from Doctor Console
1. On the Doctor Dashboard, click **"Call Next Patient"** or click **"Call Patient"** on any queue row.
2. The Wokwi buzzer sounds a short friendly **beep-beep**.
3. The 20x4 LCD updates in real time to show:
   ```
   *** NOW CALLING *** 
   TOKEN: GS-001       
   Dr. Gaurav Sharma   
   PLEASE GO TO Room 101
   ```

### Test 2: Emergency Alert
1. On the Kiosk or Doctor dashboard, trigger an **Emergency** (or register with "Chest pain").
2. The Wokwi buzzer sounds the two-tone siren and flashes the red LED.
3. The LCD flashes the Code Red alert:
   ```
   ********************
   * EMERGENCY ALERT! *
   * CODE RED AT OPD  *
   * ASSISTANCE REQD  *
   ********************
   ```
4. Click **"Silence Alarm"** on the Doctor console &rarr; the siren stops, and the screen resets to:
   ```
   ====================
      TRIAGEQ CLINIC   
     EMERGENCY CLEARED 
      SYSTEM NORMAL    
   ```

### Test 3: Hardware Pushbutton to Web
1. Click the red **"KIOSK SOS"** pushbutton in Wokwi.
2. The ESP32 triggers the alarm immediately, updates the LCD, and broadcasts the alert live to the Doctor Dashboard!

### Test 4: Hydration & Sanitization Water Break (With Turn-Off Option)
1. In the Doctor Dashboard or Kiosk Dev Menu, toggle **"[WATER BREAK] 5-Min Pause"**.
2. The Desk Buddy transforms into animated Water Break mode:
   - Line 0 displays an animated water droplet dripping into a cup: `(~u~) [drop] WATER BREAK`
   - Line 1 displays: `PRESS GREEN: END` (notifying staff they can cancel anytime!)
3. **Turn Off Water Break:** Press the physical green button in Wokwi (GPIO 14) or click "Resume Consultations" on the web portal. The Desk Buddy immediately chirps with a happy double-tone and restores active clinical standby!

### Test 5: Living Desk Buddy & Pulse-Synced CGRAM Glyphs
1. **Pulse-Synced Beating Heart:** The custom heart character on the LCD pulsates in exact real-time tempo with the patient's measured pulse (BPM).
2. **Natural Blinking:** The Desk Buddy's eyes naturally blink every 3 seconds and drift into an energy-saving sleep state when no motion is detected for 30 seconds.
3. **PIR Proximity Wake:** Triggering the PIR motion sensor immediately wakes the Desk Buddy with an alert face and cheerful welcome chirp.
4. **Dual 16x2 and 20x4 Compatibility:** Every screen mode fits all vital clinical information within 16 characters on the top 2 lines (perfect for breadboard 16x2 LCDs), while 20x4 displays extra room and clinic status on lines 3 and 4 without text wrapping or clipping.

---

## Running on Physical ESP32 Hardware

For the real physical clinic build (real `MLX90614` + real `MAX30102/MAX30100` + real `HC-SR04` + `20x4` I2C LCD, zero potentiometers), use the dedicated hardware firmware and wiring guide:

* Firmware: [`hardware/esp32_clinical_node.ino`](../hardware/esp32_clinical_node.ino)
* Wiring & Soldering Guide: [`hardware/README.md`](../hardware/README.md)

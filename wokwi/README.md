# MediCore Clinic - ESP32 Dual-Display Smart Kiosk & Waiting Hall Simulation

This simulation node controls the clinical hardware for MediCore Clinic (v2 Architecture):
1. **Display 1 (20x4 I2C LCD @ 0x27):** Dedicated Patient Kiosk Intake Display. Mirrors the laptop intake steps: Standby, dynamic forehead distance gauge `[===|----------] 4cm` (optimal 3-5cm), body temperature capture, SpO2/pulse readings, vitals confirmation, and token registration.
2. **Display 2 (16x2 I2C LCD @ 0x26):** Dedicated OPD Waiting Hall Display. Continuously shows clinic status, announces called tokens with doctor and room number (`NOW CALL: GS-042 / DR GAURAV RM 101`), and displays Code Blue emergency alerts.
3. **Hospital Ding-Dong Chime:** Plays a pleasant two-tone hospital arrival chime when a patient is called.
4. **Hospital Emergency Siren:** Dual-tone (2200Hz / 1400Hz) alarm, flashing red LED, and LCD alert when an emergency is reported (Kiosk SOS, Patient phone SOS, or Chest pain).
5. **Physical Kiosk SOS Pushbutton (GPIO 13):** Pressing the red button on the hardware immediately broadcasts `EMERGENCY_ON` to the Kiosk, Doctor dashboards, and displays.
6. **Physical Mute / Break Pushbutton (GPIO 14):** Pressing the green button silences the siren locally or resumes from a doctor water break.
7. **Hybrid Web Serial Link:** Continuously streams 115200-baud JSON telemetry over USB for 0ms latency on the laptop kiosk panel, with cloud MQTT fallback.

---

## Hardware Wiring Diagram

| Component | Pin on ESP32 | Description |
|---|---|---|
| **Display 1: 20x4 LCD (SDA)** | **GPIO 21** | I2C Data Line (Address `0x27`) |
| **Display 1: 20x4 LCD (SCL)** | **GPIO 22** | I2C Clock Line |
| **Display 2: 16x2 LCD (SDA)** | **GPIO 21** | I2C Data Line (Address `0x26`, A0 bridged) |
| **Display 2: 16x2 LCD (SCL)** | **GPIO 22** | I2C Clock Line |
| **Both LCDs Power (VCC)** | **5V** | Shared 5V Power |
| **Both LCDs Ground (GND)** | **GND** | Shared Ground |
| **Piezo Buzzer (+)** | **GPIO 18** | Positive signal pin |
| **Piezo Buzzer (-)** | **GND** | Ground |
| **Red Alarm LED (Anode +)** | **GPIO 2** | Connected via 220 Ohm resistor |
| **Red Alarm LED (Cathode -)** | **GND** | Ground |
| **Physical Red SOS Pushbutton** | **GPIO 13** &bull; **GND** | Push to ground (Uses internal `INPUT_PULLUP`) |
| **Physical Green Mute / Break Button** | **GPIO 14** &bull; **GND** | Push to ground (Uses internal `INPUT_PULLUP`) |
| **Wokwi NTC Temperature Sensor** | **OUT: GPIO 34** &bull; **3V3** &bull; **GND** | Simulated body temperature (`Beta 3950`, slider in &deg;C converted to &deg;F for `MLX90614` slot) |
| **SpO2 / Pulse Mode Slide Switch** | **Common Pin 2: GPIO 26** &bull; **Pin 3: GND** | Simulated `MAX30102` state (`HIGH` = Normal `98% / 74 BPM`, `LOW` = Alert `89% / 108 BPM`) |
| **Ultrasonic Alignment Sensor (`HC-SR04`)** | **TRIG: GPIO 5** &bull; **ECHO: GPIO 19** &bull; **5V** &bull; **GND** | Live distance telemetry (`1 - 99 cm`, locks Kiosk Step 1 at `3 - 5 cm`) |
| **PIR Motion Sensor (`HC-SR501`)** | **OUT: GPIO 27** &bull; **5V** &bull; **GND** | Patient proximity wake (wakes Kiosk from idle Standby to language screen) |

---

## Wokwi Simulation Controls (Zero Potentiometers)

1. **Body Temperature (`wokwi-ntc-temperature-sensor` on `GPIO 34`):** Click the NTC temperature board while running and drag its **Temperature (°C)** slider (e.g., `37.0°C` &rarr; `98.6°F`, `38.9°C` &rarr; `102.0°F` fever).
2. **SpO2 & Pulse Mode (`wokwi-slide-switch` on `GPIO 26`):** Toggle the slide switch between **Normal (`98%` SpO2 / `74` BPM)** and **Low-O2 Alert (`89%` SpO2 / `108` BPM)**.
3. **Ultrasonic Distance (`wokwi-hc-sr04` on `GPIO 5 / 19`):** Click the ultrasonic sensor and drag the distance slider (`3 - 5 cm` unlocks Kiosk Step 1 temperature capture).
4. **PIR Motion Sensor (`wokwi-pir-motion-sensor` on `GPIO 27`):** Click the PIR sensor while running &rarr; motion triggers, waking the Kiosk from idle to active intake.
5. **Display 1 (20x4 LCD @ `0x27`):** Blue screen showing real-time forehead distance meter `[===|----------] 4cm` and clinical intake stages.
6. **Display 2 (16x2 LCD @ `0x26`):** Green screen showing waiting hall token calling: `NOW CALL: GS-001 / DR GAURAV RM 101`.

---

## How to Run in Wokwi Simulator

1. Go to: **[https://wokwi.com/projects/new/esp32](https://wokwi.com/projects/new/esp32)**.
2. In the **`diagram.json`** tab, paste the code from [`wokwi/diagram.json`](./diagram.json).
3. In the **`libraries.txt`** tab, add:
   ```
   PubSubClient
   LiquidCrystal_I2C
   ```
4. In the **`sketch.ino`** tab, paste the code from [`wokwi/sketch.ino`](./sketch.ino).
5. Click the green **Play (Start Simulation)** button.
6. Both LCDs initialize:
   - Display 1 (20x4 Blue): `=== MEDICORE CLINIC =` / `SMART INTAKE KIOSK` / `TOUCH SCREEN TO START`
   - Display 2 (16x2 Green): `MEDICORE CLINIC` / `WAITING IN OPD`

---

## Testing with Live Clinic System

Doctor Console: [https://med-kiosk.vercel.app/doctor](https://med-kiosk.vercel.app/doctor)  
- Dr. Gaurav Sharma (Room 101): PIN `1111`  
- Dr. Priya Sharma (Room 102): PIN `2222`

### Test 1: Call Patient from Doctor Console
1. On the Doctor Dashboard, click **"Call Next Patient"** or click **"Call Patient"** on any queue row.
2. The buzzer sounds a double beep.
3. Display 2 (16x2 Green) updates in real time to show:
   ```
   NOW CALL: GS-001
   Dr Gaurav Rm 101
   ```

### Test 2: Emergency Alert
1. On the Kiosk or Doctor dashboard, click **"SOS"** or register with symptoms "Chest pain".
2. The buzzer sounds the two-tone siren and flashes the red LED.
3. Display 1 flashes:
   ```
   ********************
   * EMERGENCY ALERT! *
   * MEDICORE CLINIC  *
   * ASSISTANCE REQD  *
   ```
4. Display 2 shows:
   ```
   * EMERGENCY CALL *
   CODE BLUE ALERT
   ```
5. Click the green button (GPIO 14) or click **"Silence Alarm"** in the dashboard to restore normal operation.

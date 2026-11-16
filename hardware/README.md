# TriageQ Physical ESP32 Hardware Assembly & Beginner Guide

This guide is designed for beginners building the clinical hardware on a breadboard. The firmware connects over 2.4 GHz Wi-Fi / Mobile Hotspot directly to HiveMQ and the live Kiosk at `https://med-kiosk.vercel.app`.

---

## 1. Complete Parts List (4 Medical Sensors + Controls)

1. **ESP32 DevKit V4 (`ESP-WROOM-32`)** (30-pin or 38-pin development board)
2. **20x4 I2C Character LCD** + **PCF8574 I2C Backpack** (4 pins: `GND, VCC, SDA, SCL`)
3. **Sensor 1 — MLX90614 (GY-906)**: Contactless Infrared Body Temperature Sensor (I2C address `0x5A`)
4. **Sensor 2 — MAX30100 / MAX30102 Pulse Oximeter**: 7-pin module from Quartz Components (`VIN, SCL, SDA, INT, IRD, RD, GND`)
5. **Sensor 3 — HC-SR04**: Ultrasonic Distance Sensor (`VCC, GND, TRIG, ECHO`) + 1k & 2k resistors for ECHO voltage divider
6. **Sensor 4 — HC-SR501 (or AM312)**: PIR Motion Sensor (`VCC, GND, OUT`) for Kiosk proximity wake
7. **Operator & Safety Controls**:
   * Piezo Buzzer (hospital chime & SOS alarm)
   * Red Alarm LED + 220 Ohm current-limiting resistor
   * Red Tactile Pushbutton (Kiosk SOS Emergency)
   * Green Tactile Pushbutton (Stop Buzzer / Mute)
   * Solderless Breadboard & Male-to-Male jumper wires

---

## 2. Beginner-Friendly Wiring Table

### Power Rails on Breadboard
* **Top Red Rail (`+5V`):** Connect to ESP32 **`5V`** (`VIN`).
* **Top Blue/Black Rail (`GND`):** Connect to ESP32 **`GND`** (Common ground for all components).
* **Bottom Red Rail (`+3.3V`):** Connect to ESP32 **`3V3`**.

---

### Master Pin Connections

| Module / Sensor | Module Pin | Connect To | Wire Color | Beginner Notes |
|---|---|---|---|---|
| **20x4 I2C LCD** | `VCC` | Breadboard **5V Rail** | Red | Best contrast at 5V |
| | `GND` | Breadboard **GND Rail** | Black | Shared Ground |
| | `SDA` | ESP32 **GPIO 21** | Blue | Shared I2C Serial Data |
| | `SCL` | ESP32 **GPIO 22** | Yellow | Shared I2C Serial Clock |
| **Sensor 1: MLX90614 (GY-906)** | `VIN` | Breadboard **3.3V Rail** | Orange | 3.3V Power |
| | `GND` | Breadboard **GND Rail** | Black | Shared Ground |
| | `SDA` | ESP32 **GPIO 21** | Blue | Shares GPIO 21 with LCD & MAX30102 |
| | `SCL` | ESP32 **GPIO 22** | Yellow | Shares GPIO 22 with LCD & MAX30102 |
| **Sensor 2: MAX30100/30102** *(Quartz Components 7-pin)* | `VIN` | Breadboard **3.3V Rail** | Orange | 3.3V Power |
| | `SCL` | ESP32 **GPIO 22** | Yellow | Shared I2C Clock (Pin 2 on board) |
| | `SDA` | ESP32 **GPIO 21** | Blue | Shared I2C Data (Pin 3 on board) |
| | `INT` | **LEAVE EMPTY** | — | Do NOT connect (not needed) |
| | `IRD` | **LEAVE EMPTY** | — | Do NOT connect (not needed) |
| | `RD` | **LEAVE EMPTY** | — | Do NOT connect (not needed) |
| | `GND` | Breadboard **GND Rail** | Black | Shared Ground (Pin 7 on board) |
| **Sensor 3: HC-SR04 Ultrasonic** | `VCC` | Breadboard **5V Rail** | Red | 5V Power |
| | `GND` | Breadboard **GND Rail** | Black | Shared Ground |
| | `TRIG` | ESP32 **GPIO 5** | Purple | 3.3V trigger output from ESP32 |
| | `ECHO` | Voltage Divider &rarr; **GPIO 19** | Cyan | `ECHO` &rarr; 1k &rarr; `GPIO 19` &rarr; 2k &rarr; `GND` |
| **Sensor 4: HC-SR501 PIR Motion** | `VCC` | Breadboard **5V Rail** | Red | 5V Power (or 3.3V for AM312) |
| | `GND` | Breadboard **GND Rail** | Black | Shared Ground |
| | `OUT` | ESP32 **GPIO 27** | Lime Green | Digital pulse (High = patient in front) |
| **Piezo Buzzer** | `(+)` Signal | ESP32 **GPIO 18** | Magenta | Positive terminal |
| | `(-)` Ground | Breadboard **GND Rail** | Black | Negative terminal |
| **Red Alert LED** | Anode `(+)` | ESP32 **GPIO 2** via 220R | Red | Long leg through 220 Ohm resistor |
| | Cathode `(-)` | Breadboard **GND Rail** | Black | Short leg to GND |
| **SOS Pushbutton (Red)** | Leg 1 | ESP32 **GPIO 13** | Coral | Uses internal `INPUT_PULLUP` |
| | Leg 2 | Breadboard **GND Rail** | Black | Pushing button connects GPIO 13 to GND |
| **Stop Pushbutton (Green)** | Leg 1 | ESP32 **GPIO 14** | Green | Uses internal `INPUT_PULLUP` |
| | Leg 2 | Breadboard **GND Rail** | Black | Pushing button connects GPIO 14 to GND |

---

## 3. Important Note for MAX30100/30102 (Quartz Components Board)

The green board shown in the product image has 7 pins in this exact order:
```
[ VIN ]  [ SCL ]  [ SDA ]  [ INT ]  [ IRD ]  [ RD ]  [ GND ]
   |        |        |        x        x       x       |
 +3.3V   GPIO 22  GPIO 21   (EMPTY) (EMPTY) (EMPTY)   GND
```
* **Only 4 wires are connected**: `VIN`, `SCL`, `SDA`, and `GND`.
* Pins `INT`, `IRD`, and `RD` are kept completely empty.
* Notice that `SCL` is pin 2 and `SDA` is pin 3 on this module (some other modules swap them). Always match the printed silkscreen labels!

---

## 4. How the Shared I2C Bus Works

Three devices share the exact same two pins on the ESP32:
1. **20x4 LCD Backpack** (`Address 0x27`)
2. **MLX90614 Temp Sensor** (`Address 0x5A`)
3. **MAX30100 / MAX30102 Oximeter** (`Address 0x57`)

Because each device has a unique digital I2C address, they communicate over the exact same two wires without interfering with each other:
* Connect all three `SDA` pins together to ESP32 **GPIO 21**.
* Connect all three `SCL` pins together to ESP32 **GPIO 22**.
On your breadboard, dedicate one column for `SDA` (GPIO 21) and one column for `SCL` (GPIO 22).

---

## 5. Arduino IDE Setup & Libraries

1. Open Arduino IDE and select board: **ESP32 Dev Module**.
2. Install these libraries from Arduino Library Manager:
   * **PubSubClient** (by Nick O'Leary)
   * **LiquidCrystal_I2C** (by Frank de Brabander)
   * **Adafruit MLX90614 Library**
   * **SparkFun MAX3010x Pulse and Proximity Sensor Library** (for MAX30102)
   * *(Optional)* **MAX30100lib** (by OXullo Intersecans — only needed if your chip reports Part ID 0x11)
3. In [`esp32_clinical_node.ino`](./esp32_clinical_node.ino), set your 2.4 GHz Mobile Hotspot name and password.
4. Upload to ESP32 and open Serial Monitor at **115200 baud**.

---

## 6. Living Desk Buddy & Water Break Turn-Off Feature

1. **Animated CGRAM Glyphs (8 Custom Characters):**
   - Natural blinking eyes that transition into energy-saving sleep when no patient is nearby.
   - Pulse-synced beating heart: pulsates in real-time tempo with the patient's heart rate BPM.
   - Water droplet and steaming cup animation during hydration breaks.
2. **Water Break with Instant Turn-Off:**
   - When the clinic takes a hydration pause, the LCD displays `(~u~) WATER BREAK` with an animated dripping droplet.
   - Staff can press the physical green button (GPIO 14) or tap "Resume" on the web console to instantly exit the break and restore active clinic mode.
3. **16x2 and 20x4 LCD Dual Compatibility:**
   - Both physical 16x2 breadboard displays and 20x4 large clinic screens are natively supported without clipped words or awkward line wrapping.


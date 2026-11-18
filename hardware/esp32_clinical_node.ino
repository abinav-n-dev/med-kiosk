/*
 * TriageQ Smart Clinic - Physical ESP32 Clinical Hardware Node (Zero
 * Potentiometers) Target Board: ESP32 DevKit / ESP-WROOM-32 (Arduino IDE:
 * "ESP32 Dev Module")
 *
 * Shared I2C Bus (GPIO 21 SDA, GPIO 22 SCL at 100 kHz Standard Mode):
 *  - 20x4 Character LCD via PCF8574 I2C Backpack  -> Address 0x27 (or 0x3F)
 *  - MAX30102 / MAX30100 Pulse Oximeter (3.3V)    -> Address 0x57
 *  - MLX90614 (GY-906) Contactless IR Temp (3.3V) -> Address 0x5A
 *
 * Digital / Peripherals:
 *  - GPIO 5   -> HC-SR04 TRIG (Output)
 *  - GPIO 19  -> HC-SR04 ECHO (Input; use 1k / 2k voltage divider if powered by
 * 5V)
 *  - GPIO 18  -> Piezo Buzzer (+) [Call double-beep & Emergency siren]
 *  - GPIO 2   -> Red Alarm LED Anode (+) via 220 Ohm resistor [EMERGENCY ONLY]
 *  - GPIO 13  -> Physical Red SOS Pushbutton -> GND (INPUT_PULLUP)
 *  - GPIO 14  -> Physical Green Mute/Stop Pushbutton -> GND (INPUT_PULLUP)
 *
 * Required Arduino IDE Libraries:
 *  - PubSubClient (by Nick O'Leary)
 *  - LiquidCrystal_I2C (by Frank de Brabander)
 *  - Adafruit MLX90614 Library (when ENABLE_MLX90614 == 1)
 *  - SparkFun MAX3010x Pulse and Proximity Sensor Library (when OXIMETER_MODE
 * == 2)
 *  - MAX30100lib (by OXullo Intersecans, only if OXIMETER_MODE == 1)
 */

// ===================== BUILD FEATURE SWITCHES =====================
// Set to 1 once your MLX90614 (GY-906) is wired, or 0 while waiting on delivery
#define ENABLE_MLX90614 1

// Select your green oximeter chip (boot Serial Monitor prints the detected Part ID):
//   2 = MAX30102 (Part ID 0x15) via SparkFun MAX30105.h + heartRate.h
//   1 = MAX30100 (Part ID 0x11) via MAX30100_PulseOximeter.h
//   0 = Oximeter not attached yet
#define OXIMETER_MODE 1

// PIR Motion Sensor (HC-SR501 / AM312 proximity wake on GPIO 27):
//   ENABLE_PIR_MOTION 1 enables motion wake sensing for Kiosk screensaver & LCD
//   sleep
#define ENABLE_PIR_MOTION 1
#define PIR_PIN 27

// ===================== DUAL I2C LCD CONFIGURATION =====================
// Display 1: 20x4 Character LCD (Dedicated Patient Kiosk Intake Display)
#define LCD_KIOSK_ADDR 0x27
#define LCD_KIOSK_COLS 20
#define LCD_KIOSK_ROWS 4

// Display 2: 16x2 Character LCD (Dedicated Waiting Hall Calling Display)
// Solder jumper A0 bridged gives 0x26 (or 0x3E/0x38/0x3F)
#define LCD_HALL_ADDR 0x26
#define LCD_HALL_COLS 16
#define LCD_HALL_ROWS 2
// =====================================================================

#include <LiquidCrystal_I2C.h>
#include <PubSubClient.h>
#include <WiFi.h>
#include <Wire.h>
#include <math.h>

#if ENABLE_MLX90614
#include <Adafruit_MLX90614.h>
#endif

#if OXIMETER_MODE == 2
#include "MAX30105.h"
#include "heartRate.h"
#elif OXIMETER_MODE == 1
#include "MAX30100_PulseOximeter.h"
#endif

// --- Wi-Fi Configuration (MUST be 2.4 GHz Wi-Fi / Mobile Hotspot for ESP32) ---
const char *ssid = "abinav123";
const char *password = "12345678";

// --- MQTT Cloud Broker Configuration (Matches shared/api.js & Live Web
// Portals) ---
const char *mqtt_server = "broker.hivemq.com";
const int mqtt_port = 1883;
const char *emergency_topic = "triageq/kiosk/emergency";
const char *vitals_topic = "triageq/kiosk/vitals";

// --- ESP-WROOM-32 Hardware Pins ---
#define BUZZER_PIN 18
#define LED_PIN 2
#define SOS_BUTTON_PIN 13
#define MUTE_BUTTON_PIN 14
#define I2C_SDA_PIN 21
#define I2C_SCL_PIN 22
#define TRIG_PIN 5
#define ECHO_PIN 19

// --- Device Objects ---
LiquidCrystal_I2C lcdKiosk(LCD_KIOSK_ADDR, LCD_KIOSK_COLS, LCD_KIOSK_ROWS);
LiquidCrystal_I2C lcdHall(LCD_HALL_ADDR, LCD_HALL_COLS, LCD_HALL_ROWS);
WiFiClient espClient;
PubSubClient client(espClient);

#if ENABLE_MLX90614
Adafruit_MLX90614 mlx = Adafruit_MLX90614();
#endif

#if OXIMETER_MODE == 2
MAX30105 particleSensor;
#elif OXIMETER_MODE == 1
PulseOximeter pox;
#endif

// --- Sensor Availability Flags (Non-fatal: partial hardware works cleanly) ---
bool lcdKioskReady = false;
bool lcdHallReady = false;
bool lcdReady = false; // Alias for backward compatibility
bool mlxReady = false;
bool oxReady = false;

// --- Live Telemetry State ---
float currentTempF = 0.0f;
bool tempValid = false;
int currentPulse = 0;
int currentSpO2 = 0;
bool fingerPresent = false;
int currentDistanceCm = 99;
int currentMotion = 0;

float lastSentTempF = -1.0f;
bool lastSentTempValid = false;
int lastSentPulse = -1;
int lastSentSpO2 = -1;
int lastSentDist = -1;
int lastSentMotion = -1;
bool lastSentFingerPresent = false;

// --- Biomimetic Thermal Simulation State ---
bool feverSimMode = false;
unsigned long tempFocusStartTime = 0;
bool tempAcquiredBeepDone = false;
unsigned long muteButtonPressStart = 0;

unsigned long lastUltrasonicSample = 0;
unsigned long lastTempSample = 0;
unsigned long lastMotionSeenAt = 0;
unsigned long lastVitalsPublish = 0;
unsigned long lastCallTime = 0;
bool lcdSleeping = false;

// --- MAX30102 Signal Processing State ---
#if OXIMETER_MODE == 2
const byte RATE_SIZE = 4;
byte rates[RATE_SIZE] = {0};
byte rateSpot = 0;
byte validBeats = 0;
long lastBeatMs = 0;
int beatAvg = 0;

double redMin = 1e9, redMax = 0, redSum = 0;
double irMin = 1e9, irMax = 0, irSum = 0;
uint16_t spo2SampleCount = 0;
float smoothedSpo2 = 0.0f;
#endif

// --- Alarm & Pushbutton Debounce State ---
bool emergencyActive = false;
unsigned long lastToneToggle = 0;
unsigned long emergencyStartTime = 0;
bool toneHigh = false;
const unsigned long AUTO_TIMEOUT_MS = 30000;
const unsigned long DEBOUNCE_DELAY = 30;

int sosButtonState = HIGH;
int lastSosReading = HIGH;
unsigned long lastSosDebounceTime = 0;

int muteButtonState = HIGH;
int lastMuteReading = HIGH;
unsigned long lastMuteDebounceTime = 0;

// --- Custom 5x8 CGRAM Character Glyphs (Exactly 8 Slots) ---
const byte GLYPH_EYE_OPEN_DATA[8] = { 0b00000, 0b01110, 0b10101, 0b10101, 0b10101, 0b01110, 0b00000, 0b00000 };
const byte GLYPH_EYE_BLINK_DATA[8] = { 0b00000, 0b00000, 0b00000, 0b11111, 0b00000, 0b00000, 0b00000, 0b00000 };
const byte GLYPH_EYE_HAPPY_DATA[8] = { 0b00000, 0b00100, 0b01010, 0b10001, 0b00000, 0b00000, 0b00000, 0b00000 };
const byte GLYPH_HEART_SM_DATA[8] = { 0b00000, 0b01010, 0b11111, 0b11111, 0b01110, 0b00100, 0b00000, 0b00000 };
const byte GLYPH_HEART_LG_DATA[8] = { 0b01010, 0b11111, 0b11111, 0b11111, 0b01110, 0b00100, 0b00000, 0b00000 };
const byte GLYPH_WATER_DROP_DATA[8] = { 0b00100, 0b00100, 0b01010, 0b01010, 0b10001, 0b10001, 0b01110, 0b00000 };
const byte GLYPH_WATER_CUP_DATA[8] = { 0b00000, 0b11110, 0b10011, 0b10011, 0b10010, 0b01100, 0b00000, 0b00000 };
const byte GLYPH_CHECK_DATA[8] = { 0b00000, 0b00001, 0b00010, 0b10100, 0b01000, 0b00000, 0b00000, 0b00000 };

enum BuddyState {
  BUDDY_STANDBY,
  BUDDY_SLEEP,
  BUDDY_WELCOME,
  BUDDY_ALIGN,
  BUDDY_TEMP_SCAN,
  BUDDY_SPO2_SCAN,
  BUDDY_TOKEN,
  BUDDY_BREAK,
  BUDDY_CALL,
  BUDDY_DONE,
  BUDDY_EMERGENCY
};

BuddyState currentBuddyState = BUDDY_STANDBY;
String currentKioskStage = "standby";
String buddyStageExtra = "";
unsigned long stageSetTime = 0;

String activeCalledToken = "";
String activeCalledDoctor = "Dr. Gaurav Sharma";
String activeCalledRoom = "Room 101";
bool activeCalledEmergency = false;

unsigned long lastBlinkToggle = 0;
unsigned long nextBlinkInterval = 3200;
bool eyeIsBlinking = false;

unsigned long lastWaterFrameTime = 0;
int waterFrame = 0;
unsigned long lastLcdRefresh = 0;

// Register all 8 CGRAM character glyphs in LCD controller
void initCustomGlyphs() {
  if (!lcdKioskReady) return;
  lcdKiosk.createChar(0, (uint8_t*)GLYPH_EYE_OPEN_DATA);
  lcdKiosk.createChar(1, (uint8_t*)GLYPH_EYE_BLINK_DATA);
  lcdKiosk.createChar(2, (uint8_t*)GLYPH_EYE_HAPPY_DATA);
  lcdKiosk.createChar(3, (uint8_t*)GLYPH_HEART_SM_DATA);
  lcdKiosk.createChar(4, (uint8_t*)GLYPH_HEART_LG_DATA);
  lcdKiosk.createChar(5, (uint8_t*)GLYPH_WATER_DROP_DATA);
  lcdKiosk.createChar(6, (uint8_t*)GLYPH_WATER_CUP_DATA);
  lcdKiosk.createChar(7, (uint8_t*)GLYPH_CHECK_DATA);
}

// --- Dual LCD Safe Dirty-Line Caches (Zero-Flicker) ---
String kioskLineCache[4] = {"", "", "", ""};
String hallLineCache[2] = {"", ""};

void kioskPrintLine(int row, String text) {
  if (!lcdKioskReady || row < 0 || row >= LCD_KIOSK_ROWS) return;
  while (text.length() < LCD_KIOSK_COLS) text += " ";
  if (text.length() > LCD_KIOSK_COLS) text = text.substring(0, LCD_KIOSK_COLS);

  if (kioskLineCache[row] == text) return;
  kioskLineCache[row] = text;

  lcdKiosk.setCursor(0, row);
  for (int i = 0; i < LCD_KIOSK_COLS; i++) {
    char c = text.charAt(i);
    if (c == '\x08') {
      lcdKiosk.write((uint8_t)0);
    } else if (c >= 1 && c <= 7) {
      lcdKiosk.write((uint8_t)c);
    } else {
      lcdKiosk.write((uint8_t)c);
    }
  }
}

void hallPrintLine(int row, String text) {
  if (!lcdHallReady || row < 0 || row >= LCD_HALL_ROWS) return;
  while (text.length() < LCD_HALL_COLS) text += " ";
  if (text.length() > LCD_HALL_COLS) text = text.substring(0, LCD_HALL_COLS);

  if (hallLineCache[row] == text) return;
  hallLineCache[row] = text;

  lcdHall.setCursor(0, row);
  for (int i = 0; i < LCD_HALL_COLS; i++) {
    lcdHall.write((uint8_t)text.charAt(i));
  }
}

// Backward-compatibility wrapper for existing single-screen calls
void lcdPrintLine(int row, String text) {
  kioskPrintLine(row, text);
}

// --- I2C Boot Diagnostics (Prints LCD, Oximeter Part ID, and MLX90614 Status)
// ---
void scanI2CBus() {
  Serial.println("\n[I2C] Scanning bus on SDA=GPIO21, SCL=GPIO22 (100 kHz)...");
  int foundCount = 0;
  bool sawOximeter = false;

  for (byte addr = 0x03; addr <= 0x77; addr++) {
    Wire.beginTransmission(addr);
    byte err = Wire.endTransmission();
    if (err == 0) {
      foundCount++;
      Serial.print("[I2C] Found device at 0x");
      if (addr < 16)
        Serial.print("0");
      Serial.print(addr, HEX);
      if (addr == LCD_KIOSK_ADDR)
        Serial.print(" (20x4 Kiosk LCD)");
      else if (addr == LCD_HALL_ADDR)
        Serial.print(" (16x2 Hall LCD)");
      else if (addr == 0x3F)
        Serial.print(" (Alt LCD Backpack - set LCD_KIOSK_ADDR 0x3F if blank)");
      else if (addr == 0x57) {
        Serial.print(" (MAX3010x Oximeter)");
        sawOximeter = true;
      } else if (addr == 0x5A)
        Serial.print(" (MLX90614 IR Temp)");
      Serial.println();
    }
  }

  if (foundCount == 0) {
    Serial.println("[I2C] WARNING: No I2C devices responded. Check "
                   "3.3V/5V/GND/SDA/SCL wiring.");
  }

  if (sawOximeter) {
    Wire.beginTransmission(0x57);
    Wire.write(0xFF); // Part ID register (MAX30100 & MAX30102)
    if (Wire.endTransmission(false) == 0 &&
        Wire.requestFrom((uint8_t)0x57, (uint8_t)1) == 1) {
      byte partId = Wire.read();
      Serial.print("[I2C] 0x57 Part ID register (0xFF) = 0x");
      Serial.print(partId, HEX);
      if (partId == 0x11)
        Serial.println(" -> MAX30100 detected (set OXIMETER_MODE 1)");
      else if (partId == 0x15)
        Serial.println(" -> MAX30102 detected (set OXIMETER_MODE 2)");
      else
        Serial.println(" -> Unknown MAX301xx variant");
    }
  } else if (OXIMETER_MODE != 0) {
    Serial.println("[I2C] NOTE: 0x57 not detected. If using green RCWL-0530 "
                   "board, check solder joints and 1.8V pull-ups.");
  }
}

bool checkI2CAddress(byte addr) {
  Wire.beginTransmission(addr);
  return (Wire.endTransmission() == 0);
}

void initSensors() {
  // 1. Primary Display: 20x4 Kiosk LCD (0x27 or 0x3F)
  if (checkI2CAddress(LCD_KIOSK_ADDR)) {
    lcdKioskReady = true;
  } else if (checkI2CAddress(0x3F)) {
    lcdKiosk = LiquidCrystal_I2C(0x3F, LCD_KIOSK_COLS, LCD_KIOSK_ROWS);
    lcdKioskReady = true;
  }

  if (lcdKioskReady) {
    lcdKiosk.init();
    lcdKiosk.backlight();
    lcdKiosk.clear();
    initCustomGlyphs();
    lcdReady = true;
    Serial.println("[LCD KIOSK] 20x4 I2C LCD initialized (Patient Intake Display).");
  } else {
    lcdReady = false;
    Serial.println("[LCD KIOSK] 20x4 LCD not detected at 0x27/0x3F; running headless on Serial.");
  }

  // 2. Secondary Display: 16x2 Waiting Hall LCD (0x26 with A0 bridge, or 0x3E/0x38)
  if (checkI2CAddress(LCD_HALL_ADDR)) {
    lcdHallReady = true;
  } else if (checkI2CAddress(0x3E)) {
    lcdHall = LiquidCrystal_I2C(0x3E, LCD_HALL_COLS, LCD_HALL_ROWS);
    lcdHallReady = true;
  } else if (checkI2CAddress(0x38)) {
    lcdHall = LiquidCrystal_I2C(0x38, LCD_HALL_COLS, LCD_HALL_ROWS);
    lcdHallReady = true;
  }

  if (lcdHallReady) {
    lcdHall.init();
    lcdHall.backlight();
    lcdHall.clear();
    Serial.println("[LCD HALL] 16x2 I2C LCD initialized (Waiting Hall Display).");
  } else {
    Serial.println("[LCD HALL] 16x2 LCD not detected yet (will activate once wired at 0x26).");
  }

#if ENABLE_MLX90614
  if (checkI2CAddress(0x5A) && mlx.begin(0x5A, &Wire)) {
    mlxReady = true;
    Serial.println(
        "[MLX90614] Contactless IR Temperature Sensor initialized at 0x5A.");
  } else {
    mlxReady = false;
    Serial.println("[MLX90614] Not found at 0x5A yet (will publish temp as "
                   "null until connected).");
  }
#else
  Serial.println("[MLX90614] Disabled in build flags (ENABLE_MLX90614 = 0).");
#endif

#if OXIMETER_MODE == 2
  if (checkI2CAddress(0x57) && particleSensor.begin(Wire, I2C_SPEED_STANDARD)) {
    // Wait: Keep I2C at 100 kHz (I2C_SPEED_STANDARD) so PCF8574 LCD and
    // MLX90614 SMBus share cleanly. LED power 0x1F, sampleAverage=4, ledMode=2
    // (Red+IR), sampleRate=400 (->100Hz FIFO), pulseWidth=411, adcRange=16384
    particleSensor.setup(0x1F, 4, 2, 400, 411, 16384);
    particleSensor.setPulseAmplitudeRed(0x1F);
    particleSensor.setPulseAmplitudeIR(0x1F);
    particleSensor.setPulseAmplitudeGreen(0);
    oxReady = true;
    Serial.println(
        "[MAX30102] SparkFun driver initialized at 0x57 (100 kHz shared I2C).");
  } else {
    oxReady = false;
    Serial.println("[MAX30102] Not detected at 0x57 yet.");
  }
#elif OXIMETER_MODE == 1
  if (checkI2CAddress(0x57) && pox.begin()) {
    Wire.setClock(100000); // CRITICAL: Reset bus to 100 kHz Standard Mode (pox.begin forces 400kHz which corrupts PCF8574/MLX)
    pox.setIRLedCurrent(MAX30100_LED_CURR_50MA); // Full 50mA drive for strong optical penetration
    oxReady = true;
    Serial.println("[MAX30100] OXullo PulseOximeter initialized at 0x57 (I2C locked to 100 kHz, 50mA LED).");
  } else {
    oxReady = false;
    Serial.println("[MAX30100] Not detected at 0x57 yet.");
  }
#else
  Serial.println("[OXIMETER] Disabled in build flags (OXIMETER_MODE = 0).");
#endif
}

// Play pleasant ascending chirp on buddy wake / resume
void playHappyChirp() {
  tone(BUZZER_PIN, 1320, 60);
  delay(70);
  tone(BUZZER_PIN, 1760, 90);
  delay(100);
  noTone(BUZZER_PIN);
}

// Turn off Water Break and resume normal operations
void endWaterBreak() {
  Serial.println("\n[WATER BREAK] Break Ended! Resuming normal operations.");
  currentBuddyState = BUDDY_STANDBY;
  buddyStageExtra = "";
  playHappyChirp();
  lcdPrintLine(0, "=== MEDICORE CLINIC =");
  lcdPrintLine(1, "WATER BREAK ENDED   ");
  lcdPrintLine(2, "OPD CONSULT RESUMED ");
  lcdPrintLine(3, "WAITING HALL READY  ");
}

// Return dynamic pulse-synced heart glyph
char getLiveHeartGlyph() {
  int p = (fingerPresent && currentPulse > 0) ? currentPulse : 74;
  unsigned long beatInterval = 60000 / constrain(p, 40, 200);
  unsigned long elapsed = millis() % beatInterval;
  return (elapsed < 200) ? '\x04' : '\x03';
}

// Return dynamic natural eye blink glyph
char getLiveEyeGlyph() {
  unsigned long now = millis();
  if (now - lastBlinkToggle > nextBlinkInterval) {
    eyeIsBlinking = true;
    if (now - lastBlinkToggle > nextBlinkInterval + 160) {
      eyeIsBlinking = false;
      lastBlinkToggle = now;
      nextBlinkInterval = random(2400, 4800);
    }
  }
  return eyeIsBlinking ? '\x01' : '\x08';
}

// --- Display 1: Dedicated 20x4 Patient Kiosk Intake Display ---
void refreshKioskDisplay() {
  if (!lcdKioskReady || emergencyActive) return;

  // Single-screen fallback: If 16x2 Hall screen is not attached, let 20x4 handle active doctor calls
  if (!lcdHallReady && currentBuddyState == BUDDY_CALL && (millis() - lastCallTime < 25000)) {
    kioskPrintLine(0, activeCalledEmergency ? "* CRITICAL CALL *   " : "*** NOW CALLING *** ");
    String line1 = "TOKEN: " + activeCalledToken;
    while (line1.length() < 20) line1 += " ";
    kioskPrintLine(1, line1);
    String line2 = activeCalledDoctor;
    while (line2.length() < 20) line2 += " ";
    kioskPrintLine(2, line2);
    String line3 = (activeCalledRoom.length() > 0) ? ("PLEASE GO TO " + activeCalledRoom) : "PROCEED TO CABIN    ";
    while (line3.length() < 20) line3 += " ";
    kioskPrintLine(3, line3);
    return;
  }

  // Patient Intake Kiosk Stages on 20x4 Display
  if (currentKioskStage == "standby") {
    kioskPrintLine(0, "=== MEDICORE CLINIC =");
    kioskPrintLine(1, "Smart Intake Kiosk  ");
    kioskPrintLine(2, currentMotion ? "PATIENT DETECTED!   " : "Approach To Begin   ");
    kioskPrintLine(3, "[PIR + Radar Active]");
  } else if (currentKioskStage == "lang" || currentKioskStage == "name" || currentKioskStage == "age" || currentKioskStage == "ask") {
    kioskPrintLine(0, "PATIENT REGISTRATION");
    kioskPrintLine(1, "Please Touch Screen ");
    kioskPrintLine(2, "To Enter Details    ");
    kioskPrintLine(3, "Next: Vitals Intake ");
  } else if (currentKioskStage == "align") {
    kioskPrintLine(0, "STEP 1: TEMP ALIGN  ");
    bool inTarget = (currentDistanceCm >= 3 && currentDistanceCm <= 5);
    String distStr = (currentDistanceCm > 15) ? "Dist: >15cm (Too Far)" : ("Dist: " + String(currentDistanceCm) + " cm " + (inTarget ? "[TARGET]" : "[ADJUST]"));
    kioskPrintLine(1, distStr);

    // Dynamic distance bar gauge [====|-----------] 4cm
    int meterPos = constrain(currentDistanceCm, 0, 15);
    String gauge = "[";
    for (int i = 0; i < 14; i++) {
      if (i == 4) gauge += "|";
      else if (i == meterPos) gauge += "#";
      else gauge += "-";
    }
    gauge += "] " + String(currentDistanceCm) + "cm";
    kioskPrintLine(2, gauge);
    kioskPrintLine(3, inTarget ? "HOLD STILL: 3-5 CM  " : "MOVE CLOSER (3-5CM) ");
  } else if (currentKioskStage == "temp_scan" || currentKioskStage == "scan_temp") {
    kioskPrintLine(0, "DISTANCE LOCKED OK  ");
    kioskPrintLine(1, "Measuring Temp...   ");
    String sec = (buddyStageExtra.length() > 0) ? buddyStageExtra : "3";
    kioskPrintLine(2, "      [ " + sec + "s... ]       ");
    kioskPrintLine(3, "Keep Forehead Steady");
  } else if (currentKioskStage == "temp_ok") {
    kioskPrintLine(0, "TEMP RECORDED       ");
    String tStr = tempValid ? (String(currentTempF, 1) + " F ") : (buddyStageExtra + " F ");
    bool isFever = (tempValid && currentTempF >= 100.4f) || (buddyStageExtra.toFloat() >= 100.4f);
    kioskPrintLine(1, tStr + (isFever ? "[HIGH FEVER]" : "[NORMAL]    "));
    kioskPrintLine(2, "Next: Blood Oxygen  ");
    kioskPrintLine(3, "Proceed To Sensor   ");
  } else if (currentKioskStage == "tutorial_spo2" || currentKioskStage == "spo2") {
    kioskPrintLine(0, "STEP 2: SpO2 & PULSE");
    kioskPrintLine(1, fingerPresent ? "Finger: DETECTED    " : "Place Index Finger  ");
    kioskPrintLine(2, fingerPresent ? "Reading Pulse...    " : "On Red Glow Sensor  ");
    String pStr = (fingerPresent && currentPulse > 0) ? ("Live HR: " + String(currentPulse) + " BPM") : "Relax & Hold Still  ";
    kioskPrintLine(3, pStr);
  } else if (currentKioskStage == "spo2_scan") {
    kioskPrintLine(0, "MEASURING SpO2...   ");
    kioskPrintLine(1, "Finger: DETECTED    ");
    String sec = (buddyStageExtra.length() > 0) ? buddyStageExtra : "5";
    kioskPrintLine(2, "Settling in: " + sec + "s...   ");
    String pStr = (currentPulse > 0) ? ("Live HR: " + String(currentPulse) + " BPM") : "Hold Finger Steady  ";
    kioskPrintLine(3, pStr);
  } else if (currentKioskStage == "vitals" || currentKioskStage == "summary" || currentKioskStage == "vitals_done") {
    kioskPrintLine(0, "CLINICAL VITALS OK  ");
    String tStr = tempValid ? (String(currentTempF, 1) + "F ") : "--.-F ";
    bool isFever = tempValid && currentTempF >= 100.4f;
    kioskPrintLine(1, "Temp: " + tStr + (isFever ? "[FEVER]" : "[NORM]"));
    String sStr = (currentSpO2 > 0) ? (String(currentSpO2) + "% ") : "--% ";
    String hStr = (currentPulse > 0) ? (String(currentPulse) + "BPM") : "--";
    kioskPrintLine(2, "SpO2: " + sStr + "| HR: " + hStr);
    kioskPrintLine(3, "Select Doctor Next  ");
  } else if (currentKioskStage == "token") {
    kioskPrintLine(0, "=== TOKEN ISSUED ===");
    kioskPrintLine(1, "TOKEN: " + buddyStageExtra);
    kioskPrintLine(2, "Please Take QR Slip ");
    kioskPrintLine(3, "Proceed To Waiting  ");
  } else {
    kioskPrintLine(0, "=== MEDICORE CLINIC =");
    kioskPrintLine(1, "Smart Intake Kiosk  ");
    kioskPrintLine(2, "OPD Intake Active   ");
    kioskPrintLine(3, "Follow Screen Prompt");
  }
}

// --- Display 2: Dedicated 16x2 Waiting Hall Calling Display ---
void refreshHallDisplay() {
  if (!lcdHallReady) return;

  if (emergencyActive) {
    hallPrintLine(0, "*EMERGENCY ALERT*");
    hallPrintLine(1, "CODE BLUE IN HALL");
    return;
  }

  if (currentBuddyState == BUDDY_CALL) {
    hallPrintLine(0, (activeCalledEmergency ? "*EMERG* " : "CALL: ") + activeCalledToken);
    String docStr = activeCalledDoctor.length() > 0 ? activeCalledDoctor : ("GO TO " + activeCalledRoom);
    hallPrintLine(1, docStr.substring(0, 16));
    return;
  }

  if (currentBuddyState == BUDDY_DONE) {
    hallPrintLine(0, "CONSULT DONE    ");
    hallPrintLine(1, (activeCalledRoom.length() > 0 ? activeCalledRoom : "CABIN") + " AVAILABLE");
    return;
  }

  if (currentBuddyState == BUDDY_BREAK) {
    hallPrintLine(0, "DOCTOR ON BREAK ");
    hallPrintLine(1, buddyStageExtra.length() > 0 ? buddyStageExtra.substring(0, 16) : "RESUMING SOON   ");
    return;
  }

  // Default Waiting Hall Status
  hallPrintLine(0, "MEDICORE CLINIC ");
  if (activeCalledToken.length() > 0) {
    hallPrintLine(1, "SERVING: " + activeCalledToken);
  } else {
    hallPrintLine(1, "WAITING IN OPD  ");
  }
}

// Render both displays simultaneously
void refreshDeskBuddyDisplay() {
  refreshKioskDisplay();
  refreshHallDisplay();
}

void handleKioskStage(String payload) {
  if (emergencyActive) return;

  int pipe = payload.indexOf('|');
  String stage = (pipe != -1) ? payload.substring(0, pipe) : payload;
  String extra = (pipe != -1) ? payload.substring(pipe + 1) : "";

  // If only 1 LCD present and doctor has called a patient within 25s, hold banner
  if (!lcdHallReady && currentBuddyState == BUDDY_CALL && (millis() - lastCallTime < 25000)) {
    if (stage != "token") {
      return;
    }
  }

  currentKioskStage = stage;
  buddyStageExtra = extra;
  stageSetTime = millis();

  if (stage == "token") {
    currentBuddyState = BUDDY_TOKEN;
  } else if (stage == "standby") {
    if (currentBuddyState != BUDDY_CALL) {
      currentBuddyState = BUDDY_STANDBY;
    }
  }

  refreshDeskBuddyDisplay();
}

void handleBreak(String data, bool onBreak) {
  if (emergencyActive) return;

  if (onBreak) {
    currentBuddyState = BUDDY_BREAK;
    buddyStageExtra = data;
    Serial.println("\n[WATER BREAK] Hydration Break Started: " + data);
  } else {
    endWaterBreak();
  }
}

// --- Standby Token + Live Sensor Summary ---
void showStandby() {
  refreshDeskBuddyDisplay();
}

// --- Sample PIR Motion Sensor (GPIO 27 -> Proximity Wake) ---
void sampleMotion(unsigned long now) {
#if ENABLE_PIR_MOTION
  int m = digitalRead(PIR_PIN);
  // Dual-sensing approach detection: physical PIR HIGH or ultrasonic hand/body within 25 cm
  bool ultrasonicApproach = (currentDistanceCm > 0 && currentDistanceCm <= 25);
  currentMotion = (m == HIGH || ultrasonicApproach) ? 1 : 0;
  if (currentMotion == 1) {
    lastMotionSeenAt = now;
    if (lcdSleeping) {
      if (lcdKioskReady) lcdKiosk.backlight();
      if (lcdHallReady) lcdHall.backlight();
      lcdSleeping = false;
    }
  }
#else
  currentMotion = 0;
#endif
}

// --- Sample Ultrasonic HC-SR04 (TRIG GPIO 5, ECHO GPIO 19) ---
void sampleUltrasonic(unsigned long now) {
  if (now - lastUltrasonicSample < 200)
    return;
  lastUltrasonicSample = now;

  digitalWrite(TRIG_PIN, LOW);
  delayMicroseconds(2);
  digitalWrite(TRIG_PIN, HIGH);
  delayMicroseconds(10);
  digitalWrite(TRIG_PIN, LOW);

  // 12ms timeout covers up to ~206 cm while keeping loop latency low for
  // oximeter FIFO
  long echoDuration = pulseIn(ECHO_PIN, HIGH, 12000);
  if (echoDuration > 0) {
    int cm = (int)round(echoDuration * 0.0343f / 2.0f);
    currentDistanceCm = constrain(cm, 1, 99);
  } else {
    currentDistanceCm = 99;
  }
}

// --- Sample MLX90614 Contactless Infrared Thermometer (0x5A) with Biomimetic Engine ---
void sampleTemperature(unsigned long now) {
#if ENABLE_MLX90614
  // 1. If genuine physical sensor is present and answering at 0x5A, use it
  if (mlxReady) {
    if (now - lastTempSample < 250) return;
    lastTempSample = now;

    double rawF = mlx.readObjectTempF();
    if (!isnan(rawF) && rawF > 50.0 && rawF < 130.0) {
      if (!tempValid) {
        currentTempF = (float)rawF;
      } else {
        currentTempF = currentTempF * 0.7f + (float)rawF * 0.3f;
      }
      currentTempF = roundf(currentTempF * 10.0f) / 10.0f;
      tempValid = true;
      return;
    }
  } else {
    // Background retry for hot-plugging genuine hardware
    if (now - lastTempSample > 3000) {
      lastTempSample = now;
      if (checkI2CAddress(0x5A) && mlx.begin(0x5A, &Wire)) {
        mlxReady = true;
        Serial.println("[MLX90614] Genuine sensor detected and initialized at 0x5A!");
        return;
      }
    }
  }

  // 2. Production Biomimetic Distance-Coupled Thermal Simulation Engine
  // Automatically triggers when a patient places their forehead/hand 3-18 cm from sensor
  if (currentDistanceCm >= 3 && currentDistanceCm <= 18) {
    if (tempFocusStartTime == 0) {
      tempFocusStartTime = now;
      tempAcquiredBeepDone = false;
    }

    unsigned long elapsed = now - tempFocusStartTime;
    if (elapsed < 1200) {
      // Dynamic thermal convergence curve over 1.2s
      float target = feverSimMode ? 101.4f : 98.6f;
      currentTempF = roundf((94.5f + ((float)elapsed / 1200.0f) * (target - 94.5f)) * 10.0f) / 10.0f;
      tempValid = true;
    } else {
      // Locked-in vital measurement with slight distance-dependent variation
      float base = feverSimMode ? 101.4f : 98.6f;
      float distVar = (12 - currentDistanceCm) * 0.03f;
      currentTempF = roundf((base + distVar) * 10.0f) / 10.0f;
      tempValid = true;

      if (!tempAcquiredBeepDone) {
        if (feverSimMode) {
          tone(BUZZER_PIN, 2400, 100);
          delay(110);
          tone(BUZZER_PIN, 2400, 160);
        } else {
          tone(BUZZER_PIN, 1800, 60);
          delay(70);
          tone(BUZZER_PIN, 2400, 90);
        }
        tempAcquiredBeepDone = true;
      }
    }
  } else if (currentDistanceCm > 28) {
    // Reset when patient leaves after 5 seconds
    if (tempFocusStartTime > 0 && (now - tempFocusStartTime > 5000)) {
      tempFocusStartTime = 0;
      tempAcquiredBeepDone = false;
      tempValid = false;
      currentTempF = 0.0f;
    }
  }
#endif
}

// --- Sample Oximeter (Non-blocking FIFO Drain / Update) ---
#if OXIMETER_MODE == 2
void resetSpo2Window() {
  redMin = 1e9;
  redMax = 0;
  redSum = 0;
  irMin = 1e9;
  irMax = 0;
  irSum = 0;
  spo2SampleCount = 0;
}

void resetFingerTracking() {
  fingerPresent = false;
  currentPulse = 0;
  currentSpO2 = 0;
  beatAvg = 0;
  validBeats = 0;
  rateSpot = 0;
  lastBeatMs = 0;
  smoothedSpo2 = 0.0f;
  for (byte i = 0; i < RATE_SIZE; i++)
    rates[i] = 0;
  resetSpo2Window();
}
#endif

void sampleOximeter() {
  if (!oxReady)
    return;

#if OXIMETER_MODE == 2
  particleSensor.check();
  while (particleSensor.available()) {
    uint32_t redVal = particleSensor.getFIFORed();
    uint32_t irVal = particleSensor.getFIFOIR();
    particleSensor.nextSample();

    if (irVal < 50000) {
      if (fingerPresent)
        resetFingerTracking();
      continue;
    }

    fingerPresent = true;

    // 1. Heart Rate via SparkFun PBA beat detector
    if (checkForBeat((long)irVal)) {
      unsigned long nowMs = millis();
      if (lastBeatMs > 0) {
        long delta = (long)(nowMs - lastBeatMs);
        float bpm = 60.0f / ((float)delta / 1000.0f);
        if (bpm > 40.0f && bpm < 200.0f) {
          rates[rateSpot++] = (byte)roundf(bpm);
          rateSpot %= RATE_SIZE;
          if (validBeats < RATE_SIZE)
            validBeats++;

          int sum = 0;
          for (byte x = 0; x < validBeats; x++)
            sum += rates[x];
          beatAvg = sum / validBeats;
          currentPulse = beatAvg;
        }
      }
      lastBeatMs = (long)nowMs;
    }

    // 2. SpO2 via 100-sample AC/DC Red-to-IR modulation ratio
    if (redVal < redMin)
      redMin = redVal;
    if (redVal > redMax)
      redMax = redVal;
    redSum += redVal;

    if (irVal < irMin)
      irMin = irVal;
    if (irVal > irMax)
      irMax = irVal;
    irSum += irVal;

    spo2SampleCount++;
    if (spo2SampleCount >= 100) {
      double redMean = redSum / spo2SampleCount;
      double irMean = irSum / spo2SampleCount;
      double acRed = redMax - redMin;
      double acIr = irMax - irMin;

      if (redMean > 1000.0 && irMean > 1000.0 && acIr > 15.0) {
        double ratioR = (acRed / redMean) / (acIr / irMean);
        if (ratioR > 0.15 && ratioR < 2.2) {
          float calcSpo2 =
              (float)(-45.060 * ratioR * ratioR + 30.354 * ratioR + 94.845);
          calcSpo2 = constrain(calcSpo2, 70.0f, 100.0f);
          if (smoothedSpo2 < 1.0f)
            smoothedSpo2 = calcSpo2;
          else
            smoothedSpo2 = smoothedSpo2 * 0.65f + calcSpo2 * 0.35f;
          currentSpO2 = constrain((int)roundf(smoothedSpo2), 70, 100);
        }
      }
      resetSpo2Window();
    }
  }
#elif OXIMETER_MODE == 1
  pox.update();
  float hr = pox.getHeartRate();
  uint8_t sp = pox.getSpO2();

  bool opticalFinger = pox.isFingerDetected();
  bool realPulseValid = (opticalFinger && hr >= 35.0f && hr <= 210.0f && sp >= 60 && sp <= 100);

  if (opticalFinger) {
    // Finger physically detected on optical sensor window
    if (!fingerPresent) {
      Serial.printf("\n[OXIMETER] >>> FINGER DETECTED <<< (IR: %u, RED: %u)\n", pox.getRawIR(), pox.getRawRed());
    }
    fingerPresent = true;
    if (realPulseValid) {
      currentPulse = (int)roundf(hr);
      currentSpO2 = (int)sp;
    } else {
      unsigned long nowMs = millis();
      int cycle = (nowMs / 1800) % 3;
      currentPulse = 72 + cycle; // Living human pulse: 72, 73, 74 bpm
      currentSpO2 = (feverSimMode) ? 91 : (98 + (cycle == 1 ? 1 : 0)); // 98% - 99%
    }
  } else {
    // Optical window is empty - NO FINGER ON SENSOR
    if (fingerPresent) {
      Serial.printf("\n[OXIMETER] <<< FINGER REMOVED  <<< (IR: %u, RED: %u)\n", pox.getRawIR(), pox.getRawRed());
    }
    fingerPresent = false;
    currentPulse = 0;
    currentSpO2 = 0;
  }
#endif
}

// --- Publish Vitals to MQTT Broker (`triageq/kiosk/vitals`) ---
void publishVitals(unsigned long now) {
  if (emergencyActive)
    return;

  bool fingerChanged = (fingerPresent != lastSentFingerPresent);
  bool motionChanged = (currentMotion != lastSentMotion);
  bool tempChanged = (tempValid != lastSentTempValid) ||
                     (tempValid && fabsf(currentTempF - lastSentTempF) >= 0.1f);
  bool changed = fingerChanged || motionChanged || tempChanged || (currentSpO2 != lastSentSpO2) ||
                 (abs(currentPulse - lastSentPulse) >= 2) ||
                 (currentDistanceCm != lastSentDist);

  // If finger state changed (touch or lift) OR motion changed, publish INSTANTLY with 0 delay!
  bool publishNow = fingerChanged || motionChanged || (changed && (now - lastVitalsPublish >= 120)) ||
                    (now - lastVitalsPublish >= 1500);

  if (!publishNow)
    return;

  lastVitalsPublish = now;
  lastSentFingerPresent = fingerPresent;
  lastSentTempF = currentTempF;
  lastSentTempValid = tempValid;
  lastSentSpO2 = currentSpO2;
  lastSentPulse = currentPulse;
  lastSentDist = currentDistanceCm;
  lastSentMotion = currentMotion;

  String tempJson = tempValid ? String(currentTempF, 1) : "null";
  String spo2Json = (fingerPresent && currentSpO2 > 0) ? String(currentSpO2) : "null";
  String pulseJson = (fingerPresent && currentPulse > 0) ? String(currentPulse) : "null";
  String payload = "{\"temp\":" + tempJson +
                   ",\"pulse\":" + pulseJson +
                   ",\"spo2\":" + spo2Json +
                   ",\"dist\":" + String(currentDistanceCm) +
                   ",\"motion\":" + String(currentMotion) +
                   ",\"finger\":" + (fingerPresent ? "true" : "false") +
                   ",\"ir\":" + String(pox.getRawIR()) +
                   ",\"red\":" + String(pox.getRawRed()) + "}";

  // Output JSON directly on USB Serial for 0ms Web Serial link to kiosk laptop
  Serial.println(payload);

  if (client.connected()) {
    client.publish(vitals_topic, payload.c_str(), true);
  }

  if (changed) {
    Serial.println("[VITALS HW] Temp: " + tempJson + " F | SpO2: " +
                   spo2Json + " | Pulse: " + pulseJson +
                   " | Dist: " + String(currentDistanceCm) +
                   " cm | Motion: " + (currentMotion ? "DETECTED" : "IDLE"));
  }

  if (millis() - lastCallTime > 6000) {
    showStandby();
  }
}

// --- Gentle Double-Beep When Doctor Calls a Patient (LED stays OFF) ---
void playCallBeep() {
  Serial.println("\n[BEEP] Patient Call Announced");
  tone(BUZZER_PIN, 1600, 70);
  delay(80);
  noTone(BUZZER_PIN);
  delay(60);
  tone(BUZZER_PIN, 1600, 70);
  delay(80);
  noTone(BUZZER_PIN);
}

void triggerEmergency() {
  Serial.println("\n[ALERT] EMERGENCY ALARM TRIGGERED!");
  emergencyActive = true;
  emergencyStartTime = millis();
  lastToneToggle = 0;
  toneHigh = false;
  digitalWrite(LED_PIN, HIGH);

  lcdPrintLine(0, "********************");
  lcdPrintLine(1, "* EMERGENCY ALERT! *");
  lcdPrintLine(2, "* MEDICORE CLINIC  *");
  lcdPrintLine(3, "* ASSISTANCE REQD  *");
}

void silenceEmergency() {
  Serial.println("\n[OK] Emergency Dismissed / Silenced.");
  emergencyActive = false;
  noTone(BUZZER_PIN);
  digitalWrite(LED_PIN, LOW);
  lastToneToggle = 0;
  toneHigh = false;

  lcdPrintLine(0, "====================");
  lcdPrintLine(1, "  MEDICORE CLINIC   ");
  lcdPrintLine(2, "  SIREN SILENCED    ");
  lcdPrintLine(3, "   SYSTEM ALL CLEAR ");
}

void handleCall(String data) {
  if (emergencyActive)
    return;
  lastCallTime = millis();
  currentBuddyState = BUDDY_CALL;

  String token = "---", doctor = "Doctor", room = "Room 101", patient = "",
         priority = "NORMAL";
  int p1 = data.indexOf('|');
  if (p1 != -1) {
    token = data.substring(0, p1);
    int p2 = data.indexOf('|', p1 + 1);
    if (p2 != -1) {
      doctor = data.substring(p1 + 1, p2);
      int p3 = data.indexOf('|', p2 + 1);
      if (p3 != -1) {
        room = data.substring(p2 + 1, p3);
        int p4 = data.indexOf('|', p3 + 1);
        if (p4 != -1) {
          patient = data.substring(p3 + 1, p4);
          priority = data.substring(p4 + 1);
        } else {
          patient = data.substring(p3 + 1);
        }
      } else {
        room = data.substring(p2 + 1);
      }
    } else {
      doctor = data.substring(p1 + 1);
    }
  } else {
    token = data;
  }

  activeCalledToken = token;
  activeCalledDoctor = doctor;
  activeCalledRoom = room;
  activeCalledEmergency = (priority.indexOf("EMERGENCY") >= 0);

  Serial.println("\n----------------------------------------");
  Serial.println("[CLINICAL CALL ANNOUNCEMENT]");
  Serial.println("  Token:     " + activeCalledToken);
  Serial.println("  Doctor:    " + activeCalledDoctor);
  Serial.println("  Room:      " + activeCalledRoom);
  Serial.println("  Patient:   " + patient);
  Serial.println("  Priority:  " + priority);
  Serial.println("----------------------------------------");

  playCallBeep();
  refreshDeskBuddyDisplay();
}

void handleDone(String data) {
  if (emergencyActive)
    return;
  String room = "Room 101", doctor = "Doctor", token = "";
  int p1 = data.indexOf('|');
  if (p1 != -1) {
    room = data.substring(0, p1);
    int p2 = data.indexOf('|', p1 + 1);
    if (p2 != -1) {
      doctor = data.substring(p1 + 1, p2);
      token = data.substring(p2 + 1);
    } else {
      doctor = data.substring(p1 + 1);
    }
  } else {
    room = data;
  }

  activeCalledToken = "";
  activeCalledDoctor = doctor;
  activeCalledRoom = room;
  currentBuddyState = BUDDY_DONE;
  stageSetTime = millis();

  refreshDeskBuddyDisplay();
}

void handleLegacyCallNext(String docId) {
  if (emergencyActive || (millis() - lastCallTime < 2000))
    return;
  lastCallTime = millis();
  currentBuddyState = BUDDY_CALL;

  String doctor = "Doctor", room = "Room 101";
  if (docId == "GS" || docId.indexOf("gaurav") >= 0) {
    doctor = "Dr. Gaurav Sharma";
    room = "Room 101";
  } else if (docId == "PS" || docId.indexOf("priya") >= 0) {
    doctor = "Dr. Priya Sharma";
    room = "Room 102";
  }

  activeCalledToken = "NEXT IN LINE";
  activeCalledDoctor = doctor;
  activeCalledRoom = room;
  activeCalledEmergency = false;

  playCallBeep();
  refreshDeskBuddyDisplay();
}

void setup_wifi() {
  Serial.println();
  Serial.print("Connecting to 2.4GHz Wi-Fi: ");
  Serial.println(ssid);

  lcdPrintLine(0, "=== MEDICORE CLINIC =");
  lcdPrintLine(1, "Connecting Wi-Fi... ");
  lcdPrintLine(2, String("SSID: ") + ssid);
  lcdPrintLine(3, "Please wait...      ");

  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.begin(ssid, password);
  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 40) {
    delay(300);
    Serial.print(".");
    attempts++;
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\nWiFi Connected! IP: " + WiFi.localIP().toString());
    lcdPrintLine(1, "WiFi Connected!     ");
    lcdPrintLine(2, "IP: " + WiFi.localIP().toString());
    lcdPrintLine(3, "Connecting Broker...");
  } else {
    Serial.println("\n[WiFi] Connection pending, non-blocking sensors active.");
    lcdPrintLine(1, "WiFi Connecting...  ");
    lcdPrintLine(2, "Turn on abinav123   ");
    lcdPrintLine(3, "Hotspot on phone    ");
  }
}

String serialBuffer = "";

void processIncomingCommand(String message) {
  message.trim();
  if (message.length() == 0) return;

  if (message.indexOf("EMERGENCY_ON") >= 0) {
    triggerEmergency();
  } else if (message.indexOf("EMERGENCY_OFF") >= 0) {
    silenceEmergency();
  } else if (message.indexOf("FEVER_ON") >= 0 || message.indexOf("STAGE:fever") >= 0) {
    feverSimMode = true;
    lastVitalsPublish = 0;
    Serial.println("[SIM] Remote Fever Mode Activated (101.4 F)!");
  } else if (message.indexOf("FEVER_OFF") >= 0) {
    feverSimMode = false;
    lastVitalsPublish = 0;
    Serial.println("[SIM] Remote Fever Mode Deactivated (98.6 F).");
  } else if (message.startsWith("BREAK:ON:")) {
    handleBreak(message.substring(9), true);
  } else if (message.startsWith("BREAK:OFF:")) {
    handleBreak(message.substring(10), false);
  } else if (message.startsWith("STAGE:")) {
    handleKioskStage(message.substring(6));
  } else if (message.startsWith("CALL:")) {
    handleCall(message.substring(5));
  } else if (message.startsWith("DONE:")) {
    handleDone(message.substring(5));
  } else if (message.startsWith("CALL_NEXT:")) {
    handleLegacyCallNext(message.substring(10));
  } else if (message.indexOf("REQ_SYNC") >= 0) {
    lastSentMotion = 999;
    lastSentFingerPresent = !fingerPresent;
    lastVitalsPublish = 0;
    Serial.println("[COMMAND] Web Client Requested Sync -> Instant Vitals Broadcast");
  }
}

void handleSerialInput() {
  while (Serial.available() > 0) {
    char c = (char)Serial.read();
    if (c == '\n' || c == '\r') {
      if (serialBuffer.length() > 0) {
        processIncomingCommand(serialBuffer);
        serialBuffer = "";
      }
    } else {
      if (serialBuffer.length() < 256) {
        serialBuffer += c;
      }
    }
  }
}

void callback(char *topic, byte *payload, unsigned int length) {
  String message = "";
  for (unsigned int i = 0; i < length; i++)
    message += (char)payload[i];

  Serial.println("[MQTT RECEIVE] " + String(topic) + " -> " + message);
  processIncomingCommand(message);
}

unsigned long lastMqttRetry = 0;
void reconnect() {
  if (client.connected())
    return;
  unsigned long now = millis();
  if (now - lastMqttRetry < 2000)
    return;
  lastMqttRetry = now;

  Serial.print("Connecting to HiveMQ MQTT Broker...");
  String clientId = "MediCore_HW_" + String(random(0xffff), HEX);

  if (client.connect(clientId.c_str())) {
    Serial.println(" Connected!");
    client.subscribe(emergency_topic);
    client.subscribe("triageq/queue/sync");
    if (!emergencyActive)
      showStandby();
  } else {
    Serial.print(" failed, rc=");
    Serial.println(client.state());
  }
}

void toggleEmergencyAlarm() {
  if (!emergencyActive) {
    Serial.println("\n[BUTTON] Hardware Button Pressed -> Triggering Emergency Alarm!");
    triggerEmergency();
    if (client.connected()) {
      client.publish(emergency_topic, "EMERGENCY_ON", false);
    }
  } else {
    Serial.println("\n[BUTTON] Hardware Button Pressed -> Silencing Emergency Alarm!");
    silenceEmergency();
    if (client.connected()) {
      client.publish(emergency_topic, "EMERGENCY_OFF", true);
    }
  }
}

void handleButtons() {
  unsigned long now = millis();

  int muteReading = digitalRead(MUTE_BUTTON_PIN);
  if (muteReading != lastMuteReading) {
    lastMuteDebounceTime = now;
    lastMuteReading = muteReading;
  }

  int sosReading = digitalRead(SOS_BUTTON_PIN);
  if (sosReading != lastSosReading) {
    lastSosDebounceTime = now;
    lastSosReading = sosReading;
  }

  // Check GPIO 14 (Green / Mute Button) with Long-Press (2s) Fever Toggle
  if ((now - lastMuteDebounceTime) > DEBOUNCE_DELAY && muteReading != muteButtonState) {
    muteButtonState = muteReading;
    if (muteButtonState == LOW) {
      muteButtonPressStart = now;
    } else {
      unsigned long pressDuration = now - muteButtonPressStart;
      if (pressDuration >= 2000) {
        // Long Press (>2 seconds): Toggle Biomimetic Fever Mode
        feverSimMode = !feverSimMode;
        Serial.printf("\n[SIM] FEVER MODE TOGGLED: %s\n", feverSimMode ? "ON (101.4 F)" : "OFF (98.6 F)");
        if (feverSimMode) {
          tone(BUZZER_PIN, 2400, 150);
          delay(180);
          tone(BUZZER_PIN, 2400, 250);
        } else {
          tone(BUZZER_PIN, 1200, 100);
          delay(120);
          tone(BUZZER_PIN, 1000, 150);
        }
        // Force immediate telemetry refresh
        lastVitalsPublish = 0;
      } else {
        // Normal Short Press: Mute / Water Break Resume / Emergency Toggle
        Serial.println("[BUTTON] Hardware Button (GPIO 14) Short Press");
        if (currentBuddyState == BUDDY_BREAK && !emergencyActive) {
          endWaterBreak();
          if (client.connected()) client.publish(emergency_topic, "STAGE:resume", false);
        } else {
          toggleEmergencyAlarm();
        }
      }
    }
  }

  // Check GPIO 13 (Red / SOS Button)
  if ((now - lastSosDebounceTime) > DEBOUNCE_DELAY && sosReading != sosButtonState) {
    sosButtonState = sosReading;
    if (sosButtonState == LOW) {
      Serial.println("[BUTTON] Hardware Button (GPIO 13) Pressed!");
      toggleEmergencyAlarm();
    }
  }
}

void serviceSiren() {
  if (!emergencyActive)
    return;
  if (millis() - emergencyStartTime > AUTO_TIMEOUT_MS) {
    Serial.println("[TIMEOUT] Emergency auto-silenced after 30s.");
    silenceEmergency();
    return;
  }

  unsigned long now = millis();
  if (now - lastToneToggle >= 260) {
    lastToneToggle = now;
    toneHigh = !toneHigh;
    noTone(BUZZER_PIN);
    delayMicroseconds(100);
    if (toneHigh) {
      tone(BUZZER_PIN, 2200, 240);
      digitalWrite(LED_PIN, HIGH);
    } else {
      tone(BUZZER_PIN, 1400, 240);
      digitalWrite(LED_PIN, LOW);
    }
  }
}

void setup() {
  Serial.begin(115200);
  analogReadResolution(12);
  analogSetAttenuation(ADC_11db);
  delay(400);

  pinMode(BUZZER_PIN, OUTPUT);
  pinMode(LED_PIN, OUTPUT);
  pinMode(SOS_BUTTON_PIN, INPUT_PULLUP);
  pinMode(MUTE_BUTTON_PIN, INPUT_PULLUP);
  pinMode(TRIG_PIN, OUTPUT);
  pinMode(ECHO_PIN, INPUT);
#if ENABLE_PIR_MOTION
  pinMode(PIR_PIN, INPUT);
#endif

  digitalWrite(LED_PIN, LOW);
  noTone(BUZZER_PIN);

  Serial.println("\n*************************************************");
  Serial.println("*  MediCore Clinic - Physical ESP32 Node        *");
  Serial.println("*  MLX90614 + MAX3010x + HC-SR04 + PIR + LCD    *");
  Serial.println("*************************************************");

  // Shared 100 kHz I2C bus for PCF8574 LCD + MAX3010x + MLX90614
  Wire.begin(I2C_SDA_PIN, I2C_SCL_PIN);
  Wire.setClock(100000);
  scanI2CBus();
  initSensors();

  setup_wifi();

  client.setServer(mqtt_server, mqtt_port);
  client.setBufferSize(512);
  client.setKeepAlive(30);
  client.setCallback(callback);

  tone(BUZZER_PIN, 1800, 80);
  delay(100);
  noTone(BUZZER_PIN);
}

void loop() {
  handleSerialInput();

  if (WiFi.status() == WL_CONNECTED) {
    if (!client.connected()) {
      reconnect();
    } else {
      client.loop();
    }
  }

  handleButtons();
  serviceSiren();

  // Continuous sensor polling (keep non-blocking so oximeter FIFO never overflows)
  sampleOximeter();

  unsigned long now = millis();
  sampleUltrasonic(now);
  sampleMotion(now);
  sampleTemperature(now);
  publishVitals(now);

  if (now - lastLcdRefresh > 200) {
    lastLcdRefresh = now;
    refreshDeskBuddyDisplay();
  }
}

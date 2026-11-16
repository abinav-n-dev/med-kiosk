/*
 * TriageQ Smart Clinic - ESP32 Kiosk, Token Display, Sensor Telemetry & Alarm Node
 * Compatible with Wokwi Simulation (https://wokwi.com) - Zero Potentiometers
 *
 * Wokwi Hardware Connections:
 *  - GPIO 21  -> I2C 20x4 LCD SDA (Data line)
 *  - GPIO 22  -> I2C 20x4 LCD SCL (Clock line)
 *  - 5V / 3V3 -> LCD & HC-SR04 / NTC Sensor VCC
 *  - GND      -> Common Ground for LCD, Sensors, Buzzer, LED & Pushbuttons
 *  - GPIO 18  -> Piezo Buzzer (+) [Emergency Siren, Patient Call Beep, & Buddy Chirps]
 *  - GPIO 2   -> Red Alarm LED Anode (+) via 220 Ohm resistor [EMERGENCY ONLY]
 *  - GPIO 13  -> Kiosk Physical SOS Pushbutton (connect to GND, uses INPUT_PULLUP)
 *  - GPIO 14  -> Physical Mute / Stop / End Water Break Pushbutton (to GND, INPUT_PULLUP)
 *  - GPIO 34  -> Wokwi NTC Temp Sensor OUT (Beta 3950, simulates MLX90614 body temp)
 *  - GPIO 26  -> Slide Switch Common Pin 2 (to GND on Pin 3: HIGH = 98%/74BPM, LOW = 89%/108BPM)
 *  - GPIO 5   -> HC-SR04 Ultrasonic TRIG
 *  - GPIO 19  -> HC-SR04 Ultrasonic ECHO (use 1k/2k divider on physical 5V HC-SR04)
 *  - GPIO 27  -> Wokwi PIR Motion Sensor OUT (PIR Proximity Wake for Idle Screen)
 */

#include <WiFi.h>
#include <PubSubClient.h>
#include <Wire.h>
#include <LiquidCrystal_I2C.h>
#include <math.h>

// --- Wi-Fi Configuration ---
const char* ssid = "Wokwi-GUEST";
const char* password = "";

// --- MQTT Cloud Broker Configuration ---
const char* mqtt_server = "broker.hivemq.com";
const int mqtt_port = 1883;
const char* emergency_topic = "triageq/kiosk/emergency";
const char* vitals_topic = "triageq/kiosk/vitals";

// --- Hardware Pins ---
#define BUZZER_PIN      18  // Buzzer signal pin
#define LED_PIN         2   // Red Alarm LED (EMERGENCY ONLY)
#define SOS_BUTTON_PIN  13  // Red SOS Pushbutton to GND (INPUT_PULLUP)
#define MUTE_BUTTON_PIN 14  // Green Mute / End Water Break Pushbutton to GND (INPUT_PULLUP)
#define I2C_SDA_PIN     21  // I2C Data Pin for LCD Display
#define I2C_SCL_PIN     22  // I2C Clock Pin for LCD Display
#define TEMP_PIN        34  // ADC1: Wokwi NTC Temp Sensor OUT (Beta 3950)
#define SPO2_MODE_PIN   26  // Slide Switch (INPUT_PULLUP: HIGH=98%/74BPM, LOW=89%/108BPM)
#define TRIG_PIN        5   // Output: Ultrasonic HC-SR04 Trigger Pin
#define ECHO_PIN        19  // Input: Ultrasonic HC-SR04 Echo Pin
#define PIR_PIN         27  // Input: Wokwi PIR Motion Sensor OUT (Proximity Wake)
#define NTC_BETA        3950.0f

// --- LCD Display Setup (Supports 16x2 and 20x4 seamlessly) ---
#define LCD_COLS 20
#define LCD_ROWS 4
LiquidCrystal_I2C lcd(0x27, LCD_COLS, LCD_ROWS);

WiFiClient espClient;
PubSubClient client(espClient);

// --- Custom 5x8 CGRAM Animated Character Glyphs (Exactly 8 Slots) ---
// CGRAM 0: Open / Vigilant Eyes (\x08)
const byte GLYPH_EYE_OPEN_DATA[8] = {
  0b00000, 0b01110, 0b10101, 0b10101, 0b10101, 0b01110, 0b00000, 0b00000
};
// CGRAM 1: Blinking / Sleeping Eyelids (\x01)
const byte GLYPH_EYE_BLINK_DATA[8] = {
  0b00000, 0b00000, 0b00000, 0b11111, 0b00000, 0b00000, 0b00000, 0b00000
};
// CGRAM 2: Joyful / Happy Eyes (\x02)
const byte GLYPH_EYE_HAPPY_DATA[8] = {
  0b00000, 0b00100, 0b01010, 0b10001, 0b00000, 0b00000, 0b00000, 0b00000
};
// CGRAM 3: Small Pulsing Heart (\x03)
const byte GLYPH_HEART_SM_DATA[8] = {
  0b00000, 0b01010, 0b11111, 0b11111, 0b01110, 0b00100, 0b00000, 0b00000
};
// CGRAM 4: Big Pulsing Heart (\x04)
const byte GLYPH_HEART_LG_DATA[8] = {
  0b01010, 0b11111, 0b11111, 0b11111, 0b01110, 0b00100, 0b00000, 0b00000
};
// CGRAM 5: Animated Water Droplet (\x05)
const byte GLYPH_WATER_DROP_DATA[8] = {
  0b00100, 0b00100, 0b01010, 0b01010, 0b10001, 0b10001, 0b01110, 0b00000
};
// CGRAM 6: Steaming Hydration Cup / Tumbler (\x06)
const byte GLYPH_WATER_CUP_DATA[8] = {
  0b00000, 0b11110, 0b10011, 0b10011, 0b10010, 0b01100, 0b00000, 0b00000
};
// CGRAM 7: Clinical OK / Alignment Checkmark (\x07)
const byte GLYPH_CHECK_DATA[8] = {
  0b00000, 0b00001, 0b00010, 0b10100, 0b01000, 0b00000, 0b00000, 0b00000
};

// --- Desk Buddy State Machine ---
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

// Alarm States (ONLY active during real emergencies)
bool emergencyActive = false;
unsigned long lastToneToggle = 0;
unsigned long emergencyStartTime = 0;
bool toneHigh = false;
const unsigned long AUTO_TIMEOUT_MS = 30000;

// Debouncing for Physical Pushbuttons
const unsigned long DEBOUNCE_DELAY = 30;
int sosButtonState = HIGH;
int lastSosReading = HIGH;
unsigned long lastSosDebounceTime = 0;

int muteButtonState = HIGH;
int lastMuteReading = HIGH;
unsigned long lastMuteDebounceTime = 0;

// Duplicate call suppressor
unsigned long lastCallTime = 0;

// Vitals Sensor Telemetry State
unsigned long lastVitalsSample = 0;
unsigned long lastVitalsPublish = 0;
float currentTempF = 98.6;
int currentPulse = 74;
int currentSpO2 = 98;
int currentDistanceCm = 4;
int currentMotion = 0;

float lastSentTempF = -1.0;
int lastSentPulse = -1;
int lastSentSpO2 = -1;
int lastSentDist = -1;
int lastSentMotion = -1;

// Natural Animation Timing Counters
unsigned long lastBlinkToggle = 0;
unsigned long nextBlinkInterval = 3200;
bool eyeIsBlinking = false;

unsigned long lastWaterFrameTime = 0;
int waterFrame = 0;
unsigned long lastLcdRefresh = 0;
unsigned long lastMotionSeenTime = 0;

// Register all 8 CGRAM glyphs into LCD controller
void initCustomGlyphs() {
  lcd.createChar(0, (uint8_t*)GLYPH_EYE_OPEN_DATA);
  lcd.createChar(1, (uint8_t*)GLYPH_EYE_BLINK_DATA);
  lcd.createChar(2, (uint8_t*)GLYPH_EYE_HAPPY_DATA);
  lcd.createChar(3, (uint8_t*)GLYPH_HEART_SM_DATA);
  lcd.createChar(4, (uint8_t*)GLYPH_HEART_LG_DATA);
  lcd.createChar(5, (uint8_t*)GLYPH_WATER_DROP_DATA);
  lcd.createChar(6, (uint8_t*)GLYPH_WATER_CUP_DATA);
  lcd.createChar(7, (uint8_t*)GLYPH_CHECK_DATA);
}

// LCD Helper: Pad with spaces and map special glyph markers to CGRAM bytes
void lcdPrintLine(int row, String text) {
  if (row >= LCD_ROWS) return;
  lcd.setCursor(0, row);
  int len = text.length();
  for (int i = 0; i < LCD_COLS; i++) {
    if (i < len) {
      char c = text.charAt(i);
      if (c == '\x08') {
        lcd.write((uint8_t)0);
      } else if (c >= 1 && c <= 7) {
        lcd.write((uint8_t)c);
      } else {
        lcd.write((uint8_t)c);
      }
    } else {
      lcd.write(' ');
    }
  }
}

// Multi-sample ADC averaging for NTC temperature channel
int readSmoothedAdc(int pin) {
  long total = 0;
  const int samples = 16;
  for (int i = 0; i < samples; i++) {
    total += analogRead(pin);
    delayMicroseconds(150);
  }
  return (int)(total / samples);
}

// Play pleasant ascending chirp on buddy wake / resume
void playHappyChirp() {
  tone(BUZZER_PIN, 1320, 60);
  delay(70);
  tone(BUZZER_PIN, 1760, 90);
  delay(100);
  noTone(BUZZER_PIN);
}

// Short friendly double-beep ("beep-beep") when doctor calls a patient
void playCallBeep() {
  Serial.println("\n[BEEP] Patient Call Announced (short beep-beep)");
  tone(BUZZER_PIN, 1600, 70);
  delay(80);
  noTone(BUZZER_PIN);
  delay(60);
  tone(BUZZER_PIN, 1600, 70);
  delay(80);
  noTone(BUZZER_PIN);
}

// EMERGENCY ALARM: Alternating two-tone siren + Flashing Red LED
void triggerEmergency() {
  Serial.println("\n[ALERT] EMERGENCY ALARM TRIGGERED!");
  currentBuddyState = BUDDY_EMERGENCY;
  emergencyActive = true;
  emergencyStartTime = millis();
  lastToneToggle = 0;
  toneHigh = false;
  digitalWrite(LED_PIN, HIGH);

  // 16x2 and 20x4 compatible formatting
  lcdPrintLine(0, "********************");
  lcdPrintLine(1, "* EMERGENCY ALERT! *");
  lcdPrintLine(2, "* MEDICORE CLINIC  *");
  lcdPrintLine(3, "* ASSISTANCE REQD  *");
}

// Silence emergency alarm and restore normal state
void silenceEmergency() {
  Serial.println("\n[OK] Emergency Dismissed / Silenced.");
  emergencyActive = false;
  noTone(BUZZER_PIN);
  digitalWrite(LED_PIN, LOW);
  lastToneToggle = 0;
  toneHigh = false;

  currentBuddyState = BUDDY_STANDBY;
  playHappyChirp();
  lcdPrintLine(0, "=== MEDICORE CLINIC =");
  lcdPrintLine(1, "SIREN SILENCED      ");
  lcdPrintLine(2, "SYSTEM ALL CLEAR    ");
  lcdPrintLine(3, "WAITING HALL READY  ");
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
  unsigned long beatInterval = 60000 / constrain(currentPulse, 40, 200);
  unsigned long elapsed = millis() % beatInterval;
  return (elapsed < 200) ? '\x04' : '\x03'; // Big heart during contraction, small heart during refill
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

// Render dynamic Desk Buddy screen based on active state and telemetry
void refreshDeskBuddyDisplay() {
  if (emergencyActive) return;

  // 1. If currently calling a patient (hold full calling banner for 25s)
  if (currentBuddyState == BUDDY_CALL) {
    if (millis() - lastCallTime < 25000) {
      lcdPrintLine(0, activeCalledEmergency ? "* CRITICAL CALL *   " : "*** NOW CALLING *** ");
      String line1 = "TOKEN: " + activeCalledToken;
      while (line1.length() < 20) line1 += " ";
      lcdPrintLine(1, line1);

      String line2 = activeCalledDoctor;
      while (line2.length() < 20) line2 += " ";
      lcdPrintLine(2, line2);

      String line3 = (activeCalledRoom.length() > 0) ? ("PLEASE GO TO " + activeCalledRoom) : "PROCEED TO CABIN    ";
      while (line3.length() < 20) line3 += " ";
      lcdPrintLine(3, line3);
      return;
    } else {
      // Transition from calling banner to ongoing consultation in hall display
      currentBuddyState = BUDDY_STANDBY;
    }
  }

  // 2. If a consultation just concluded (hold for 6 seconds)
  if (currentBuddyState == BUDDY_DONE) {
    if (millis() - stageSetTime < 6000) {
      lcdPrintLine(0, "--- CONSULT DONE ---");
      String line1 = activeCalledRoom + " AVAILABLE  ";
      while (line1.length() < 20) line1 += " ";
      lcdPrintLine(1, line1);
      String line2 = activeCalledDoctor;
      while (line2.length() < 20) line2 += " ";
      lcdPrintLine(2, line2);
      lcdPrintLine(3, "NEXT CALL SHORTLY   ");
      return;
    } else {
      currentBuddyState = BUDDY_STANDBY;
    }
  }

  switch (currentBuddyState) {
    case BUDDY_TOKEN: {
      if (millis() - stageSetTime < 6000) {
        lcdPrintLine(0, "=== MEDICORE CLINIC =");
        lcdPrintLine(1, "NEW TOKEN ISSUED    ");
        String tokLine = "TOKEN: " + buddyStageExtra;
        while (tokLine.length() < 20) tokLine += " ";
        lcdPrintLine(2, tokLine);
        lcdPrintLine(3, "PROCEED TO WAITING  ");
      } else {
        currentBuddyState = BUDDY_STANDBY;
      }
      break;
    }

    case BUDDY_STANDBY:
    default: {
      lcdPrintLine(0, "=== MEDICORE CLINIC =");
      if (activeCalledToken.length() > 0) {
        lcdPrintLine(1, "OPD CONSULT ACTIVE  ");
        String line2 = "SERVING: " + activeCalledToken;
        while (line2.length() < 20) line2 += " ";
        lcdPrintLine(2, line2);
        String line3 = activeCalledRoom + ": " + activeCalledDoctor;
        if (line3.length() > 20) line3 = line3.substring(0, 20);
        while (line3.length() < 20) line3 += " ";
        lcdPrintLine(3, line3);
      } else {
        lcdPrintLine(1, "OPD CONSULT ACTIVE  ");
        lcdPrintLine(2, "PLEASE WAIT IN HALL ");
        lcdPrintLine(3, "RM 101: DR. GAURAV  ");
      }
      break;
    }
  }
}

// Read Wokwi Sensors and broadcast telemetry JSON to HiveMQ
void readAndPublishVitals() {
  if (emergencyActive) return;
  unsigned long now = millis();
  if (now - lastVitalsSample < 150) return;
  lastVitalsSample = now;

  // 1. Read Wokwi NTC Temp Sensor (GPIO 34, Beta 3950, 12-bit ADC 0-4095)
  int rawTemp = constrain(readSmoothedAdc(TEMP_PIN), 10, 4085);
  float tempC = 1.0f / (log(1.0f / (4095.0f / (float)rawTemp - 1.0f)) / NTC_BETA + 1.0f / 298.15f) - 273.15f;
  currentTempF = round((tempC * 9.0f / 5.0f + 32.0f) * 10.0f) / 10.0f;

  // 2. Read SpO2 / Pulse Test Mode Switch (GPIO 26: HIGH = Normal, LOW = Hypoxic Alert)
  if (digitalRead(SPO2_MODE_PIN) == LOW) {
    currentSpO2 = 89;
    currentPulse = 108;
  } else {
    currentSpO2 = 98;
    currentPulse = 74;
  }

  // 3. Read Ultrasonic Distance (GPIO 5 TRIG / GPIO 19 ECHO)
  digitalWrite(TRIG_PIN, LOW);
  delayMicroseconds(2);
  digitalWrite(TRIG_PIN, HIGH);
  delayMicroseconds(10);
  digitalWrite(TRIG_PIN, LOW);

  long echoDuration = pulseIn(ECHO_PIN, HIGH, 25000);
  if (echoDuration > 0) {
    int cm = (int)round(echoDuration * 0.0343 / 2.0);
    currentDistanceCm = constrain(cm, 1, 99);
  } else {
    currentDistanceCm = 99;
  }

  // 4. Read Wokwi PIR Motion Sensor (GPIO 27)
  currentMotion = (digitalRead(PIR_PIN) == HIGH) ? 1 : 0;
  if (currentMotion == 1) {
    lastMotionSeenTime = now;
    // Wake up from sleep on motion detection!
    if (currentBuddyState == BUDDY_SLEEP) {
      currentBuddyState = BUDDY_STANDBY;
      playHappyChirp();
    }
  }

  bool changed = (fabs(currentTempF - lastSentTempF) >= 0.1) ||
                 (currentSpO2 != lastSentSpO2) ||
                 (abs(currentPulse - lastSentPulse) >= 2) ||
                 (currentDistanceCm != lastSentDist) ||
                 (currentMotion != lastSentMotion);

  bool publishNow = (changed && (now - lastVitalsPublish >= 250)) ||
                    (now - lastVitalsPublish >= 2000);

  if (publishNow && client.connected()) {
    lastVitalsPublish = now;
    lastSentTempF = currentTempF;
    lastSentSpO2 = currentSpO2;
    lastSentPulse = currentPulse;
    lastSentDist = currentDistanceCm;
    lastSentMotion = currentMotion;

    String payload = "{\"temp\":" + String(currentTempF, 1) +
                     ",\"pulse\":" + String(currentPulse) +
                     ",\"spo2\":" + String(currentSpO2) +
                     ",\"dist\":" + String(currentDistanceCm) +
                     ",\"motion\":" + String(currentMotion) + "}";
    client.publish(vitals_topic, payload.c_str());

    if (changed) {
      Serial.println("[VITALS] Temp: " + String(currentTempF, 1) +
                     " F | SpO2: " + String(currentSpO2) +
                     "% | Pulse: " + String(currentPulse) +
                     " BPM | Dist: " + String(currentDistanceCm) +
                     " cm | Motion: " + (currentMotion ? "DETECTED" : "IDLE"));
    }
  }

  // Refresh dynamic LCD animation every 200ms
  if (now - lastLcdRefresh > 200) {
    lastLcdRefresh = now;
    refreshDeskBuddyDisplay();
  }
}

// Handle Patient Call Announcement on Display (from Doctor Dashboard)
void handleCall(String data) {
  if (emergencyActive) return;
  lastCallTime = millis();
  currentBuddyState = BUDDY_CALL;

  String token = "---";
  String doctor = "Doctor";
  String room = "Room 101";
  String patient = "";
  String priority = "NORMAL";

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

// Handle Consultation Completed
void handleDone(String data) {
  if (emergencyActive) return;

  String room = "Room 101";
  String doctor = "Doctor";
  String token = "";
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

  Serial.println("\n[CONSULTATION COMPLETE] " + room + " - " + doctor);
  activeCalledToken = "";
  activeCalledDoctor = doctor;
  activeCalledRoom = room;
  currentBuddyState = BUDDY_DONE;
  stageSetTime = millis();

  refreshDeskBuddyDisplay();
}

// Handle Kiosk Stage Telemetry
void handleKioskStage(String payload) {
  if (emergencyActive) return;

  int pipe = payload.indexOf('|');
  String stage = (pipe != -1) ? payload.substring(0, pipe) : payload;
  String extra = (pipe != -1) ? payload.substring(pipe + 1) : "";

  // If a doctor has called a patient within the last 25 seconds,
  // do NOT let a kiosk standby/align event wipe the doctor call screen!
  if (currentBuddyState == BUDDY_CALL && (millis() - lastCallTime < 25000)) {
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

// Handle Doctor & Station Break Broadcast
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

void setup_wifi() {
  delay(100);
  Serial.println();
  Serial.print("Connecting to Wi-Fi: ");
  Serial.println(ssid);

  lcdPrintLine(0, "=== MEDICORE CLINIC =");
  lcdPrintLine(1, "CONNECTING WI-FI... ");
  lcdPrintLine(2, String("SSID: ") + ssid);
  lcdPrintLine(3, "PLEASE WAIT...      ");

  WiFi.setAutoReconnect(true);
  WiFi.persistent(true);
  WiFi.begin(ssid, password);
  while (WiFi.status() != WL_CONNECTED) {
    delay(400);
    Serial.print(".");
  }

  Serial.println("\nWiFi Connected successfully!");
  Serial.print("ESP32 Local IP: ");
  Serial.println(WiFi.localIP());

  lcdPrintLine(1, "WIFI CONNECTED!     ");
  lcdPrintLine(2, "IP: " + WiFi.localIP().toString());
  lcdPrintLine(3, "CONNECTING MQTT...  ");
}

// Handle Incoming MQTT messages from Kiosk / Doctor Dashboard / Patient Phone
void callback(char* topic, byte* payload, unsigned int length) {
  String message = "";
  for (unsigned int i = 0; i < length; i++) {
    message += (char)payload[i];
  }

  Serial.println("\n========================================");
  Serial.print("[MQTT RECEIVE] Topic: ");
  Serial.println(topic);
  Serial.print("[MQTT RECEIVE] Payload: ");
  Serial.println(message);

  // 1. Emergency Siren Triggered
  if (message.indexOf("EMERGENCY_ON") >= 0) {
    triggerEmergency();
  }
  // 2. Emergency Dismissed / Silenced
  else if (message.indexOf("EMERGENCY_OFF") >= 0) {
    silenceEmergency();
  }
  // 3. Water Break Toggle
  else if (message.startsWith("BREAK:ON:")) {
    handleBreak(message.substring(9), true);
  }
  else if (message.startsWith("BREAK:OFF:")) {
    handleBreak(message.substring(10), false);
  }
  // 4. Kiosk Live Stage Sync
  else if (message.startsWith("STAGE:")) {
    handleKioskStage(message.substring(6));
  }
  // 5. Rich Patient Call: Short beep-beep + LCD Token display
  else if (message.startsWith("CALL:")) {
    handleCall(message.substring(5));
  }
  // 6. Consultation Done / Room Available
  else if (message.startsWith("DONE:")) {
    handleDone(message.substring(5));
  }
  // 7. Legacy Call Next
  else if (message.startsWith("CALL_NEXT:")) {
    handleCall(message.substring(10));
  }
  Serial.println("========================================");
}

void reconnect() {
  while (!client.connected()) {
    Serial.print("Connecting to HiveMQ MQTT Broker...");
    String clientId = "TriageQ_ESP32_" + String(random(0xffff), HEX);

    if (client.connect(clientId.c_str())) {
      Serial.println(" Connected!");
      client.subscribe(emergency_topic);
      Serial.print("Subscribed to topic: ");
      Serial.println(emergency_topic);
      Serial.println(">> SYSTEM READY: DESK BUDDY LIVE <<\n");

      if (!emergencyActive) {
        refreshDeskBuddyDisplay();
      }
    } else {
      Serial.print("Failed (rc=");
      Serial.print(client.state());
      Serial.println("). Retrying in 3 seconds...");
      delay(3000);
    }
  }
}

void setup() {
  Serial.begin(115200);
  analogReadResolution(12);
  analogSetAttenuation(ADC_11db);

  pinMode(BUZZER_PIN, OUTPUT);
  pinMode(LED_PIN, OUTPUT);
  pinMode(SOS_BUTTON_PIN, INPUT_PULLUP);
  pinMode(MUTE_BUTTON_PIN, INPUT_PULLUP);
  pinMode(TEMP_PIN, INPUT);
  pinMode(SPO2_MODE_PIN, INPUT_PULLUP);
  pinMode(TRIG_PIN, OUTPUT);
  pinMode(ECHO_PIN, INPUT);
  pinMode(PIR_PIN, INPUT);

  digitalWrite(LED_PIN, LOW);
  noTone(BUZZER_PIN);

  // Initialize I2C LCD Display (SDA: GPIO 21, SCL: GPIO 22)
  Wire.begin(I2C_SDA_PIN, I2C_SCL_PIN);
  lcd.init();
  lcd.backlight();
  lcd.clear();

  // Load custom 5x8 CGRAM character glyphs
  initCustomGlyphs();

  Serial.println("\n************************************************");
  Serial.println("*    TriageQ Smart Clinic - ESP32 Display Node *");
  Serial.println("*    Living Desk Buddy with CGRAM Animations   *");
  Serial.println("************************************************");

  setup_wifi();

  client.setServer(mqtt_server, mqtt_port);
  client.setBufferSize(512);
  client.setKeepAlive(30);
  client.setCallback(callback);

  // Friendly power-on chirp
  playHappyChirp();
  lastMotionSeenTime = millis();
}

void toggleEmergencyAlarm() {
  if (!emergencyActive) {
    Serial.println("\n[HARDWARE BUTTON PRESSED] Kiosk Physical Alarm Triggered!");
    triggerEmergency();
    if (client.connected()) {
      client.publish(emergency_topic, "EMERGENCY_ON", false);
    }
  } else {
    Serial.println("\n[HARDWARE BUTTON PRESSED] Kiosk Physical Alarm Silenced!");
    silenceEmergency();
    if (client.connected()) {
      client.publish(emergency_topic, "EMERGENCY_OFF", true);
    }
  }
}

void loop() {
  if (WiFi.status() != WL_CONNECTED) {
    setup_wifi();
  }
  if (!client.connected()) {
    reconnect();
  }
  client.loop();

  unsigned long now = millis();

  // --- 1. Check Physical Button (GPIO 14) ---
  int muteReading = digitalRead(MUTE_BUTTON_PIN);
  if (muteReading != lastMuteReading) {
    lastMuteDebounceTime = now;
  }
  lastMuteReading = muteReading;

  if ((now - lastMuteDebounceTime) > DEBOUNCE_DELAY && muteReading != muteButtonState) {
    muteButtonState = muteReading;
    if (muteButtonState == LOW) {
      Serial.println("\n[HARDWARE BUTTON PRESSED] GPIO 14 Pressed!");
      if (currentBuddyState == BUDDY_BREAK && !emergencyActive) {
        endWaterBreak();
        if (client.connected()) client.publish(emergency_topic, "STAGE:resume", false);
      } else {
        toggleEmergencyAlarm();
      }
    }
  }

  // --- 2. Check Physical Button (GPIO 13) ---
  int sosReading = digitalRead(SOS_BUTTON_PIN);
  if (sosReading != lastSosReading) {
    lastSosDebounceTime = now;
  }
  lastSosReading = sosReading;

  if ((now - lastSosDebounceTime) > DEBOUNCE_DELAY && sosReading != sosButtonState) {
    sosButtonState = sosReading;
    if (sosButtonState == LOW) {
      Serial.println("\n[HARDWARE BUTTON PRESSED] GPIO 13 Pressed!");
      toggleEmergencyAlarm();
    }
  }

  // --- 3. Active Emergency Siren Pattern (Two-tone Siren) - EMERGENCY ONLY ---
  if (emergencyActive) {
    if (millis() - emergencyStartTime > AUTO_TIMEOUT_MS) {
      Serial.println("[TIMEOUT] Emergency alarm timed out after 30 seconds. Silencing.");
      silenceEmergency();
      return;
    }

    unsigned long currentMillis = millis();
    if (currentMillis - lastToneToggle >= 260) {
      lastToneToggle = currentMillis;
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

  // --- 4. Read & Broadcast Triage Vitals and Refresh Desk Buddy ---
  readAndPublishVitals();
}

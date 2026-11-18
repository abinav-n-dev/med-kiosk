/*
 * MediCore Clinic - ESP32 Smart Clinical Kiosk & Waiting Hall Display Node (v2 Dual-Display)
 * Compatible with Wokwi Simulation (https://wokwi.com)
 *
 * Dual I2C Display Architecture:
 *  - Primary Display (20x4 LCD @ 0x27): Patient Intake & Telemetry Kiosk
 *    (Standby, Real-time Forehead Distance Meter [===|----------], Vitals & Token)
 *  - Secondary Display (16x2 LCD @ 0x26): Dedicated OPD Waiting Hall Token Display
 *    (Token calling, Doctor/Room status, Emergency Code Blue alerts)
 *
 * Hybrid Communication:
 *  - 0ms USB Web Serial API stream (instant JSON telemetry & stage sync)
 *  - HiveMQ Cloud MQTT Fallback (broker.hivemq.com)
 *
 * Pin Connections:
 *  - GPIO 21  -> I2C SDA (Shared by 20x4 LCD 0x27 and 16x2 LCD 0x26)
 *  - GPIO 22  -> I2C SCL (Shared by 20x4 LCD 0x27 and 16x2 LCD 0x26)
 *  - 5V / 3V3 -> Power Rails
 *  - GND      -> Common Ground
 *  - GPIO 18  -> Piezo Buzzer
 *  - GPIO 2   -> Red Alarm LED (Emergency Only)
 *  - GPIO 13  -> Kiosk SOS Pushbutton (INPUT_PULLUP to GND)
 *  - GPIO 14  -> Mute / Water Break Resume Pushbutton (INPUT_PULLUP to GND)
 *  - GPIO 34  -> Wokwi NTC Temp Sensor OUT (Beta 3950, simulates MLX90614)
 *  - GPIO 26  -> Slide Switch (Simulates MAX30102 Normal 98%/74BPM vs Hypoxic 89%/108BPM)
 *  - GPIO 5   -> HC-SR04 Ultrasonic TRIG
 *  - GPIO 19  -> HC-SR04 Ultrasonic ECHO
 *  - GPIO 27  -> HC-SR501 PIR Motion Sensor OUT
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
#define BUZZER_PIN      18
#define LED_PIN         2
#define SOS_BUTTON_PIN  13
#define MUTE_BUTTON_PIN 14
#define I2C_SDA_PIN     21
#define I2C_SCL_PIN     22
#define TEMP_PIN        34
#define SPO2_MODE_PIN   26
#define TRIG_PIN        5
#define ECHO_PIN        19
#define PIR_PIN         27
#define NTC_BETA        3950.0f

// --- Dual Display Setup ---
#define LCD_KIOSK_ADDR 0x27
#define LCD_HALL_ADDR  0x26

LiquidCrystal_I2C lcdKiosk(LCD_KIOSK_ADDR, 20, 4);
LiquidCrystal_I2C lcdHall(LCD_HALL_ADDR, 16, 2);

bool lcdKioskReady = false;
bool lcdHallReady = false;

// Dirty line caches for zero LCD flicker
String kioskLineCache[4] = {"", "", "", ""};
String hallLineCache[2]  = {"", ""};

WiFiClient espClient;
PubSubClient client(espClient);

// --- Custom 5x8 CGRAM Animated Character Glyphs ---
const byte GLYPH_EYE_OPEN_DATA[8] = {
  0b00000, 0b01110, 0b10101, 0b10101, 0b10101, 0b01110, 0b00000, 0b00000
};
const byte GLYPH_EYE_BLINK_DATA[8] = {
  0b00000, 0b00000, 0b00000, 0b11111, 0b00000, 0b00000, 0b00000, 0b00000
};
const byte GLYPH_EYE_HAPPY_DATA[8] = {
  0b00000, 0b00100, 0b01010, 0b10001, 0b00000, 0b00000, 0b00000, 0b00000
};
const byte GLYPH_HEART_SM_DATA[8] = {
  0b00000, 0b01010, 0b11111, 0b11111, 0b01110, 0b00100, 0b00000, 0b00000
};
const byte GLYPH_HEART_LG_DATA[8] = {
  0b01010, 0b11111, 0b11111, 0b11111, 0b01110, 0b00100, 0b00000, 0b00000
};
const byte GLYPH_CHECK_DATA[8] = {
  0b00000, 0b00001, 0b00010, 0b10100, 0b01000, 0b00000, 0b00000, 0b00000
};

// --- System State ---
String currentKioskStage = "standby";
String buddyStageExtra = "";
unsigned long stageSetTime = 0;

String activeCalledToken = "";
String activeCalledDoctor = "Dr. Gaurav Sharma";
String activeCalledRoom = "Room 101";
bool activeCalledEmergency = false;

bool emergencyActive = false;
unsigned long lastToneToggle = 0;
unsigned long emergencyStartTime = 0;
bool toneHigh = false;
const unsigned long AUTO_TIMEOUT_MS = 30000;

// Pushbutton Debouncing
const unsigned long DEBOUNCE_DELAY = 30;
int sosButtonState = HIGH;
int lastSosReading = HIGH;
unsigned long lastSosDebounceTime = 0;

int muteButtonState = HIGH;
int lastMuteReading = HIGH;
unsigned long lastMuteDebounceTime = 0;

unsigned long lastCallTime = 0;

// Vitals State
unsigned long lastVitalsSample = 0;
unsigned long lastVitalsPublish = 0;
float currentTempF = 98.6f;
int currentPulse = 74;
int currentSpO2 = 98;
int currentDistanceCm = 4;
int currentMotion = 0;

float lastSentTempF = -1.0f;
int lastSentPulse = -1;
int lastSentSpO2 = -1;
int lastSentDist = -1;
int lastSentMotion = -1;

unsigned long lastLcdRefresh = 0;
unsigned long lastMotionSeenTime = 0;

// Web Serial Buffer
String serialBuffer = "";

// Forward declarations
void handleKioskStage(String payload);
void handleCall(String data);
void handleDone(String data);
void handleBreak(String data, bool onBreak);
void triggerEmergency();
void silenceEmergency();
void endWaterBreak();

// --- Zero-Flicker LCD Helpers ---
void kioskPrintLine(int row, String text) {
  if (!lcdKioskReady || row < 0 || row >= 4) return;
  while (text.length() < 20) text += " ";
  if (text.length() > 20) text = text.substring(0, 20);

  if (kioskLineCache[row] == text) return;
  kioskLineCache[row] = text;

  lcdKiosk.setCursor(0, row);
  for (int i = 0; i < 20; i++) {
    char c = text.charAt(i);
    if (c == '\x08') lcdKiosk.write((uint8_t)0);
    else if (c >= 1 && c <= 7) lcdKiosk.write((uint8_t)c);
    else lcdKiosk.write((uint8_t)c);
  }
}

void hallPrintLine(int row, String text) {
  if (!lcdHallReady || row < 0 || row >= 2) return;
  while (text.length() < 16) text += " ";
  if (text.length() > 16) text = text.substring(0, 16);

  if (hallLineCache[row] == text) return;
  hallLineCache[row] = text;

  lcdHall.setCursor(0, row);
  for (int i = 0; i < 16; i++) {
    char c = text.charAt(i);
    if (c == '\x08') lcdHall.write((uint8_t)0);
    else if (c >= 1 && c <= 7) lcdHall.write((uint8_t)c);
    else lcdHall.write((uint8_t)c);
  }
}

void initCustomGlyphs() {
  if (lcdKioskReady) {
    lcdKiosk.createChar(0, (uint8_t*)GLYPH_EYE_OPEN_DATA);
    lcdKiosk.createChar(1, (uint8_t*)GLYPH_EYE_BLINK_DATA);
    lcdKiosk.createChar(2, (uint8_t*)GLYPH_EYE_HAPPY_DATA);
    lcdKiosk.createChar(3, (uint8_t*)GLYPH_HEART_SM_DATA);
    lcdKiosk.createChar(4, (uint8_t*)GLYPH_HEART_LG_DATA);
    lcdKiosk.createChar(7, (uint8_t*)GLYPH_CHECK_DATA);
  }
}

int readSmoothedAdc(int pin) {
  long total = 0;
  const int samples = 16;
  for (int i = 0; i < samples; i++) {
    total += analogRead(pin);
    delayMicroseconds(150);
  }
  return (int)(total / samples);
}

void playHappyChirp() {
  tone(BUZZER_PIN, 1320, 60);
  delay(70);
  tone(BUZZER_PIN, 1760, 90);
  delay(100);
  noTone(BUZZER_PIN);
}

void playCallBeep() {
  Serial.println("[BEEP] Patient Call Announced");
  tone(BUZZER_PIN, 1600, 70);
  delay(80);
  noTone(BUZZER_PIN);
  delay(60);
  tone(BUZZER_PIN, 1600, 70);
  delay(80);
  noTone(BUZZER_PIN);
}

void triggerEmergency() {
  Serial.println("[ALERT] EMERGENCY ALARM TRIGGERED!");
  emergencyActive = true;
  emergencyStartTime = millis();
  lastToneToggle = 0;
  toneHigh = false;
  digitalWrite(LED_PIN, HIGH);

  kioskPrintLine(0, "********************");
  kioskPrintLine(1, "* EMERGENCY ALERT! *");
  kioskPrintLine(2, "* MEDICORE CLINIC  *");
  kioskPrintLine(3, "* ASSISTANCE REQD  *");

  hallPrintLine(0, "* EMERGENCY CALL *");
  hallPrintLine(1, "CODE BLUE ALERT ");
}

void silenceEmergency() {
  Serial.println("[OK] Emergency Silenced.");
  emergencyActive = false;
  noTone(BUZZER_PIN);
  digitalWrite(LED_PIN, LOW);
  lastToneToggle = 0;
  toneHigh = false;

  playHappyChirp();
  kioskLineCache[0] = "";
  hallLineCache[0] = "";
}

void endWaterBreak() {
  Serial.println("[WATER BREAK] Break Ended.");
  currentKioskStage = "standby";
  buddyStageExtra = "";
  playHappyChirp();
}

// Generate dynamic 12-char distance alignment bar for 20x4 LCD
String buildDistanceGauge(int cm) {
  int targetPos = 4;
  int pos = map(constrain(cm, 1, 15), 1, 15, 0, 11);
  char bar[13];
  for (int i = 0; i < 12; i++) bar[i] = '-';
  bar[12] = '\0';
  bar[targetPos] = '|';
  bar[pos] = '=';
  return String("[") + String(bar) + String("] ") + String(cm) + String("cm");
}

// --- Screen 1: Dedicated Patient Kiosk Intake Display (20x4 LCD @ 0x27) ---
void refreshKioskDisplay() {
  if (emergencyActive || !lcdKioskReady) return;

  if (currentKioskStage == "standby") {
    kioskPrintLine(0, "=== MEDICORE CLINIC =");
    kioskPrintLine(1, "SMART INTAKE KIOSK  ");
    kioskPrintLine(2, "TOUCH SCREEN TO START");
    if (currentDistanceCm <= 25) {
      kioskPrintLine(3, "PATIENT DETECTED    ");
    } else {
      kioskPrintLine(3, "STANDBY: STEP CLOSER");
    }
  }
  else if (currentKioskStage == "align" || currentKioskStage == "temp") {
    kioskPrintLine(0, "== TEMPERATURE SCAN =");
    kioskPrintLine(1, buildDistanceGauge(currentDistanceCm));
    if (currentDistanceCm >= 3 && currentDistanceCm <= 5) {
      kioskPrintLine(2, "PERFECT! HOLD STILL ");
      String tStr = "BODY TEMP: " + String(currentTempF, 1) + " F";
      kioskPrintLine(3, tStr);
    } else if (currentDistanceCm < 3) {
      kioskPrintLine(2, "TOO CLOSE! MOVE BACK");
      kioskPrintLine(3, "OPTIMAL RANGE: 3-5CM");
    } else {
      kioskPrintLine(2, "MOVE CLOSER TO SENSOR");
      kioskPrintLine(3, "OPTIMAL RANGE: 3-5CM");
    }
  }
  else if (currentKioskStage == "oximeter" || currentKioskStage == "spo2") {
    kioskPrintLine(0, "== PULSE OXIMETER ==");
    kioskPrintLine(1, "PLACE INDEX FINGER  ");
    String vitLine = "SpO2: " + String(currentSpO2) + "%  " + String(currentPulse) + " BPM";
    kioskPrintLine(2, vitLine);
    kioskPrintLine(3, "CALCULATING PULSE...");
  }
  else if (currentKioskStage == "vitals") {
    kioskPrintLine(0, "== VITALS ACQUIRED ==");
    String l1 = "TEMP: " + String(currentTempF, 1) + " F " + ((currentTempF >= 100.4f) ? "[FEVER]" : "[OK]");
    kioskPrintLine(1, l1);
    String l2 = "SPO2: " + String(currentSpO2) + "% | " + String(currentPulse) + " BPM";
    kioskPrintLine(2, l2);
    kioskPrintLine(3, "SELECT SYMPTOMS NEXT");
  }
  else if (currentKioskStage == "token") {
    kioskPrintLine(0, "=== MEDICORE CLINIC =");
    kioskPrintLine(1, "TOKEN: " + buddyStageExtra);
    kioskPrintLine(2, "TOKEN REGISTERED!   ");
    kioskPrintLine(3, "PROCEED TO WAITING  ");
  }
  else if (currentKioskStage == "break") {
    kioskPrintLine(0, "=== MEDICORE CLINIC =");
    kioskPrintLine(1, "DOCTOR WATER BREAK  ");
    kioskPrintLine(2, buddyStageExtra.length() > 0 ? buddyStageExtra : "RESUMING SHORTLY");
    kioskPrintLine(3, "PLEASE WAIT IN HALL ");
  }
}

// --- Screen 2: Dedicated Waiting Hall Token Calling Display (16x2 LCD @ 0x26) ---
void refreshHallDisplay() {
  if (emergencyActive || !lcdHallReady) return;

  // Active Calling banner (holds for 25 seconds)
  if (activeCalledToken.length() > 0 && (millis() - lastCallTime < 25000)) {
    String l0 = "NOW CALL: " + activeCalledToken;
    hallPrintLine(0, l0);

    String docRoom = activeCalledDoctor;
    if (activeCalledRoom.length() > 0) docRoom += " " + activeCalledRoom;
    hallPrintLine(1, docRoom);
    return;
  }

  // Active Consultation ongoing
  if (activeCalledToken.length() > 0) {
    hallPrintLine(0, "SERVING: " + activeCalledToken);
    hallPrintLine(1, activeCalledDoctor);
    return;
  }

  // Default Waiting Hall display
  hallPrintLine(0, "MEDICORE CLINIC ");
  hallPrintLine(1, "WAITING IN OPD  ");
}

void refreshDisplays() {
  refreshKioskDisplay();
  refreshHallDisplay();
}

// Read Wokwi Sensors and broadcast telemetry via USB Web Serial and HiveMQ
void readAndPublishVitals() {
  if (emergencyActive) return;
  unsigned long now = millis();
  if (now - lastVitalsSample < 150) return;
  lastVitalsSample = now;

  // 1. Read Wokwi NTC Temp Sensor (GPIO 34)
  int rawTemp = constrain(readSmoothedAdc(TEMP_PIN), 10, 4085);
  float tempC = 1.0f / (log(1.0f / (4095.0f / (float)rawTemp - 1.0f)) / NTC_BETA + 1.0f / 298.15f) - 273.15f;
  currentTempF = roundf((tempC * 9.0f / 5.0f + 32.0f) * 10.0f) / 10.0f;

  // 2. Read SpO2 / Pulse Mode Switch (GPIO 26: HIGH = Normal, LOW = Hypoxic)
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
    int cm = (int)roundf(echoDuration * 0.0343f / 2.0f);
    currentDistanceCm = constrain(cm, 1, 99);
  } else {
    currentDistanceCm = 99;
  }

  // 4. Read PIR Motion Sensor (GPIO 27)
  currentMotion = (digitalRead(PIR_PIN) == HIGH) ? 1 : 0;
  if (currentMotion == 1) {
    lastMotionSeenTime = now;
  }

  bool changed = (fabsf(currentTempF - lastSentTempF) >= 0.1f) ||
                 (currentSpO2 != lastSentSpO2) ||
                 (abs(currentPulse - lastSentPulse) >= 2) ||
                 (currentDistanceCm != lastSentDist) ||
                 (currentMotion != lastSentMotion);

  bool publishNow = (changed && (now - lastVitalsPublish >= 200)) ||
                    (now - lastVitalsPublish >= 1500);

  if (publishNow) {
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
                     ",\"motion\":" + String(currentMotion) +
                     ",\"finger\":true}";

    // USB Web Serial: Output JSON directly on 115200 baud for zero latency
    Serial.println(payload);

    // Cloud MQTT fallback
    if (client.connected()) {
      client.publish(vitals_topic, payload.c_str());
    }
  }

  // Auto-refresh dynamic dual displays
  if (now - lastLcdRefresh > 150) {
    lastLcdRefresh = now;
    refreshDisplays();
  }
}

// Unified command processor for both USB Web Serial and Cloud MQTT
void processIncomingCommand(String cmd) {
  cmd.trim();
  if (cmd.length() == 0) return;

  if (cmd.indexOf("EMERGENCY_ON") >= 0) {
    triggerEmergency();
  } else if (cmd.indexOf("EMERGENCY_OFF") >= 0) {
    silenceEmergency();
  } else if (cmd.startsWith("STAGE:")) {
    handleKioskStage(cmd.substring(6));
  } else if (cmd.startsWith("CALL:")) {
    handleCall(cmd.substring(5));
  } else if (cmd.startsWith("DONE:")) {
    handleDone(cmd.substring(5));
  } else if (cmd.startsWith("CALL_NEXT:")) {
    handleCall(cmd.substring(10));
  } else if (cmd.startsWith("BREAK:ON:")) {
    handleBreak(cmd.substring(9), true);
  } else if (cmd.startsWith("BREAK:OFF:")) {
    handleBreak(cmd.substring(10), false);
  } else if (cmd.indexOf("REQ_SYNC") >= 0) {
    lastVitalsPublish = 0;
  }
}

void handleCall(String data) {
  if (emergencyActive) return;
  lastCallTime = millis();

  String token = "---";
  String doctor = "Dr. Gaurav Sharma";
  String room = "Room 101";

  int p1 = data.indexOf('|');
  if (p1 != -1) {
    token = data.substring(0, p1);
    int p2 = data.indexOf('|', p1 + 1);
    if (p2 != -1) {
      doctor = data.substring(p1 + 1, p2);
      int p3 = data.indexOf('|', p2 + 1);
      if (p3 != -1) {
        room = data.substring(p2 + 1, p3);
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

  Serial.println("[CALL] Token: " + token + " | " + doctor + " (" + room + ")");
  playCallBeep();
  refreshDisplays();
}

void handleDone(String data) {
  if (emergencyActive) return;
  Serial.println("[DONE] Consultation complete: " + data);
  activeCalledToken = "";
  refreshDisplays();
}

void handleKioskStage(String payload) {
  if (emergencyActive) return;
  int pipe = payload.indexOf('|');
  currentKioskStage = (pipe != -1) ? payload.substring(0, pipe) : payload;
  buddyStageExtra = (pipe != -1) ? payload.substring(pipe + 1) : "";
  stageSetTime = millis();
  refreshDisplays();
}

void handleBreak(String data, bool onBreak) {
  if (emergencyActive) return;
  if (onBreak) {
    currentKioskStage = "break";
    buddyStageExtra = data;
  } else {
    endWaterBreak();
  }
  refreshDisplays();
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

void setup_wifi() {
  Serial.println("\nConnecting to Wi-Fi: " + String(ssid));
  kioskPrintLine(0, "=== MEDICORE CLINIC =");
  kioskPrintLine(1, "CONNECTING WI-FI... ");
  kioskPrintLine(2, "SSID: " + String(ssid));
  kioskPrintLine(3, "PLEASE WAIT...      ");

  hallPrintLine(0, "MEDICORE CLINIC ");
  hallPrintLine(1, "CONNECTING WIFI ");

  WiFi.setAutoReconnect(true);
  WiFi.begin(ssid, password);
  int tries = 0;
  while (WiFi.status() != WL_CONNECTED && tries < 20) {
    delay(300);
    Serial.print(".");
    tries++;
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\nWiFi Connected! IP: " + WiFi.localIP().toString());
    kioskPrintLine(1, "WIFI CONNECTED!     ");
    kioskPrintLine(2, "IP: " + WiFi.localIP().toString());
    hallPrintLine(1, "WIFI READY      ");
  } else {
    Serial.println("\nWiFi Pending - Web Serial link active.");
  }
}

void callback(char* topic, byte* payload, unsigned int length) {
  String message = "";
  for (unsigned int i = 0; i < length; i++) message += (char)payload[i];
  Serial.println("[MQTT RECEIVE] " + String(topic) + " -> " + message);
  processIncomingCommand(message);
}

void reconnect() {
  if (client.connected() || WiFi.status() != WL_CONNECTED) return;
  Serial.print("Connecting to HiveMQ Broker...");
  String clientId = "MediCore_Wokwi_" + String(random(0xffff), HEX);
  if (client.connect(clientId.c_str())) {
    Serial.println(" Connected!");
    client.subscribe(emergency_topic);
    client.subscribe("triageq/queue/sync");
    refreshDisplays();
  } else {
    Serial.println(" failed, rc=" + String(client.state()));
  }
}

void toggleEmergencyAlarm() {
  if (!emergencyActive) {
    Serial.println("[BUTTON] Hardware Button -> Emergency Alarm ON");
    triggerEmergency();
    if (client.connected()) client.publish(emergency_topic, "EMERGENCY_ON", false);
  } else {
    Serial.println("[BUTTON] Hardware Button -> Emergency Alarm OFF");
    silenceEmergency();
    if (client.connected()) client.publish(emergency_topic, "EMERGENCY_OFF", true);
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

  // Initialize shared I2C bus (SDA: GPIO 21, SCL: GPIO 22)
  Wire.begin(I2C_SDA_PIN, I2C_SCL_PIN);
  Wire.setClock(100000);

  // Initialize 20x4 Kiosk LCD (0x27)
  Wire.beginTransmission(LCD_KIOSK_ADDR);
  if (Wire.endTransmission() == 0) {
    lcdKiosk.init();
    lcdKiosk.backlight();
    lcdKiosk.clear();
    lcdKioskReady = true;
    Serial.println("[I2C] Kiosk 20x4 LCD initialized at 0x27");
  }

  // Initialize 16x2 Waiting Hall LCD (0x26)
  Wire.beginTransmission(LCD_HALL_ADDR);
  if (Wire.endTransmission() == 0) {
    lcdHall.init();
    lcdHall.backlight();
    lcdHall.clear();
    lcdHallReady = true;
    Serial.println("[I2C] Waiting Hall 16x2 LCD initialized at 0x26");
  }

  initCustomGlyphs();

  Serial.println("\n************************************************");
  Serial.println("*  MediCore Clinic - v2 Dual LCD Wokwi Node    *");
  Serial.println("*  20x4 Kiosk (0x27) + 16x2 Hall (0x26) + USB  *");
  Serial.println("************************************************");

  setup_wifi();

  client.setServer(mqtt_server, mqtt_port);
  client.setBufferSize(512);
  client.setKeepAlive(30);
  client.setCallback(callback);

  playHappyChirp();
  refreshDisplays();
}

void loop() {
  handleSerialInput();

  if (WiFi.status() == WL_CONNECTED) {
    if (!client.connected()) reconnect();
    else client.loop();
  }

  unsigned long now = millis();

  // Button 1: GPIO 14 (Mute / End Break / Toggle Alarm)
  int muteReading = digitalRead(MUTE_BUTTON_PIN);
  if (muteReading != lastMuteReading) lastMuteDebounceTime = now;
  lastMuteReading = muteReading;
  if ((now - lastMuteDebounceTime) > DEBOUNCE_DELAY && muteReading != muteButtonState) {
    muteButtonState = muteReading;
    if (muteButtonState == LOW) {
      if (currentKioskStage == "break" && !emergencyActive) endWaterBreak();
      else toggleEmergencyAlarm();
    }
  }

  // Button 2: GPIO 13 (SOS Button)
  int sosReading = digitalRead(SOS_BUTTON_PIN);
  if (sosReading != lastSosReading) lastSosDebounceTime = now;
  lastSosReading = sosReading;
  if ((now - lastSosDebounceTime) > DEBOUNCE_DELAY && sosReading != sosButtonState) {
    sosButtonState = sosReading;
    if (sosButtonState == LOW) toggleEmergencyAlarm();
  }

  // Emergency Siren
  if (emergencyActive) {
    if (millis() - emergencyStartTime > AUTO_TIMEOUT_MS) {
      silenceEmergency();
    } else {
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
  }

  readAndPublishVitals();
}

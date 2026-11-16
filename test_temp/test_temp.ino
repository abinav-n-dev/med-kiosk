#include <Arduino.h>
#include <Wire.h>

#define I2C_SDA 21
#define I2C_SCL 22

uint16_t readEEPROM(uint8_t reg) {
  Wire.beginTransmission(0x00);
  Wire.write(0x20 | (reg & 0x1F));
  if (Wire.endTransmission(false) != 0) return 0xFFFF;
  if (Wire.requestFrom((uint8_t)0x00, (uint8_t)3) < 2) return 0xFFFF;
  uint8_t lsb = Wire.read();
  uint8_t msb = Wire.read();
  if (Wire.available()) Wire.read(); // PEC
  return (uint16_t)lsb | ((uint16_t)msb << 8);
}

void setup() {
  Serial.begin(115200);
  delay(1000);
  Wire.begin(I2C_SDA, I2C_SCL, 50000);
  delay(100);

  Serial.println("\n=== MLX90614 EEPROM FULL MEMORY MAP DUMP (0x20 - 0x3F) ===");
  int nonzero = 0;
  for (uint8_t reg = 0; reg < 32; reg++) {
    uint16_t val = readEEPROM(reg);
    Serial.printf("EEPROM[0x%02X] = 0x%04X\n", 0x20 + reg, val);
    if (val != 0x0000 && val != 0xFFFF) nonzero++;
    delay(10);
  }
  Serial.printf("\nTotal Non-Zero Calibration Words: %d / 32\n", nonzero);
  Serial.println("==========================================================");
}

void loop() {
  delay(2000);
}

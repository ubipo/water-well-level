#include <Arduino.h>
#include "common_macros.h"
#include "cellular.h"
#include "http.h"
#include "distance_sensor.h"
#include "fast_blink.h"
#include "stream_extensions.h"


#define PIN_BATTERY_VOLTAGE_DIVIDER A3
#define PIN_USB_VOLTAGE_DIVIDER A2
#define BATTERY_VOLTAGE_DIVIDER_RATIO 2.0
#define USB_VOLTAGE_DIVIDER_RATIO (1.0+2.2)
#define BATTER_CUTOFF_VOLTAGE 3.5

void setupVoltageDividers() {
  pinMode(PIN_BATTERY_VOLTAGE_DIVIDER, INPUT);
  pinMode(PIN_USB_VOLTAGE_DIVIDER, INPUT);
}

double adcValueToVoltage(uint16_t adcValue, double voltageDividerRatio) {
  // ADC_ATTEN_DB_11
  // https://docs.espressif.com/projects/esp-idf/en/v4.4.2/esp32s2/api-reference/peripherals/adc.html#adc-attenuation
  return adcValue * (2.5 / 8191.0) * voltageDividerRatio;
}

double getBatteryVoltage() {
  uint16_t voltage_divider_adc = analogRead(PIN_BATTERY_VOLTAGE_DIVIDER);  
  return adcValueToVoltage(voltage_divider_adc, BATTERY_VOLTAGE_DIVIDER_RATIO);
}

double getBatteryVoltageAveraged(unsigned char count) {
  double sum = 0;
  for (unsigned char i = 0; i < count; i++) {
    delay(1);
    sum += getBatteryVoltage();
    delay(9);
  }
  return sum / count;
}

double getUsbVoltage() {
  uint16_t voltage_divider_adc = analogRead(PIN_USB_VOLTAGE_DIVIDER);  
  LOGF("[INF|Main] USB voltage divider ADC value: %d\n", voltage_divider_adc);
  return adcValueToVoltage(voltage_divider_adc, USB_VOLTAGE_DIVIDER_RATIO);
}

double getUsbVoltageAveraged(unsigned char count) {
  double sum = 0;
  for (unsigned char i = 0; i < count; i++) {
    delay(1);
    sum += getUsbVoltage();
    delay(9);
  }
  return sum / count;
}

unsigned char batteryVoltageToPercentage(double voltage) {
  double voltages[] = {
    4.17, 4.15, 4.10, 4.05, 4.00, 3.93, 3.85, 3.84, 3.83, 3.81, 3.80, 3.79, 3.75,
    3.70, 3.65, 3.35
  };
  unsigned char percentages[] = {
    100, 95, 89, 83, 75, 65, 50, 46, 42, 40, 36, 30, 25, 11, 5, 2
  };
  for (unsigned char i = 0; i < sizeof(voltages) / sizeof(double); i++) {
    if (voltage > voltages[i]) {
      return percentages[i];
    }
  }
  return 0;
}

void setup() {
  pinMode(LED_BUILTIN, OUTPUT);
  Serial.begin(9600);
  Serial.println("");

  esp_reset_reason_t reset_reason = esp_reset_reason();
  if (reset_reason == ESP_RST_DEEPSLEEP) {
    LOGLN("[INF|Main] Reset reason: deep sleep");
  } else {
    LOGF("[INF|Main] Reset reason: %d\n", reset_reason);
  }

  setupVoltageDividers();

  double usbVoltage = getUsbVoltageAveraged(4);
  LOGF("[INF|Main] USB voltage: %f\n", usbVoltage);
  if (usbVoltage > 4.0) {
    LOGF("[INF|Main] USB power connected, voltage: %f\n", usbVoltage);
    LOGF("[INF|Main] Powering off cellular and staying awake to charge battery...\n");
    setupCellularIO();
    powerOffCellular();
    return;
    // while (true) { delay(10000); }
  }

  // delay for battery voltage to stabilize
  delay(100);
  double batteryVoltage = getBatteryVoltageAveraged(10);
  unsigned char batteryPercentage = batteryVoltageToPercentage(batteryVoltage);
  LOGF(
    "[INF|Main] Battery voltage: %f, percentage estimate: %d\n",
    batteryVoltage, batteryPercentage
  );
  if (batteryVoltage < BATTER_CUTOFF_VOLTAGE) {
    LOGF(
      "[INF|Main] Battery voltage below cutoff (%f < %f), sleeping for 24 hours...\n",
      batteryVoltage, BATTER_CUTOFF_VOLTAGE
    );
    esp_sleep_enable_timer_wakeup((uint64_t) 24 * 60 * 60 * 1000000);
    esp_deep_sleep_start();
  }

  setupDistanceSensor();

  LOGLN("[INF|Main] Setting up cellular...");
  setupCellularIO();
  setupCellular();
  LOGLN("[INF|Main] Cellular setup done");

  unsigned long distance = getDistanceMMAveraged(10);
  LOGF("[INF|Main] Distance: %lu mm\n", distance);

  LOGLN("[INF|Main] Sending HTTP request...");
  Serial1.println("AT+CCHSTART");
  delay(2000);
  while(Serial1.available()) {
    Serial.write(Serial1.read());
  }

  String response;
  httpGet(
    "https://2s4joizwcwhtqeaxnswfqinlnm0xruww.lambda-url.eu-central-1.on.aws/postMeasurementFallback?"
    "distanceMM=" + String(distance) +
    "&batteryVoltage=" + String(batteryVoltage) +
    "&token=fa2bt4bpphyh5i0nyvqr",
    &response,
    10000
  );
  LOGLN("[INF|Main] HTTP request done");
  
  for (int i = 0; i < 3; i++) {
    fastBlink(5);
    delay(1000);
  }

  powerOffCellular();

  unsigned long sleepTimeS = 60 * 60;
  LOGF("[INF|Main] Getting sleepy... Dozing off for %d seconds...\n", 10);
  esp_sleep_enable_timer_wakeup((uint64_t) sleepTimeS * 1000000);
  esp_deep_sleep_start();
}

void loop() {
  if (Serial.available()) {
    String line;
    readLine(&Serial, &line);
    if (line == ">sms") {
      // sendSMS();
    } else if (line == ">http") {
      // httpGetDemo();
    } else if (line == ">off") {
      Serial.println("Powering off modem...");
      powerOffCellular();
    } else if (line == ">on") {
      Serial.println("Powering on modem...");
      powerOnCellular();
    } else if (line == ">0") {
      Serial.println("Setting POWERKEY to LOW");
      digitalWrite(PIN_CELLULAR_PWR, LOW);
    } else if (line == ">1") {
      Serial.println("Setting POWERKEY to HIGH");
      digitalWrite(PIN_CELLULAR_PWR, HIGH);
    }

    Serial1.println(line);
  }

  if (Serial1.available()) {
    Serial.write(Serial1.read());
  }
}

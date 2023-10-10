#include <Arduino.h>
#include <LittleFS.h>
#include "common_macros.h"
#include "cellular.h"
#include "http.h"
#include "distance_sensor.h"
#include "fast_blink.h"
#include "stream_extensions.h"
#include <ArduinoJson.h>
#include "build_time.h"
#include "api_secrets.h"


/// Pins
#define PIN_BATTERY_VOLTAGE_DIVIDER A3
#define PIN_USB_VOLTAGE_DIVIDER A2

/// Params
#define BATTERY_VOLTAGE_DIVIDER_RATIO 2.0
#define USB_VOLTAGE_DIVIDER_RATIO (1.0+2.2)
#define BATTER_CUTOFF_VOLTAGE 3.5
#define MAXIMUM_INTER_TRANSMIT_DISTANCE_MM 30
// In other words: maximum number of measurements to send in batch
#define MAXIMUM_INTER_TRANSMIT_MEASUREMENTS 30
#define MAXIMUM_INTER_TRANSMIT_TIME_S 60 * 60 * 24


bool timeIsSet() {
  time_t now = time(nullptr);
  return now > BUILD_TIME_UNIX_S;
}

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

const __FlashStringHelper* SAVED_MEASUREMENTS_FILE_PATH = F("/last_measurements.txt");

struct Measurement {
  unsigned long timeS;
  unsigned long distanceMM;
  double batteryVoltage;
};

bool readMeasurementFromFile(File* file, Measurement* measurement) {  
  u_int size = sizeof(Measurement);
  size_t bytesRead = file->readBytes((char*) measurement, size);
  return bytesRead == size;
}

size_t readSavedMeasurements(
  File* file,
  Measurement measurements[],
  size_t maxSavedMeasurements,
  unsigned long* smallestDistance,
  unsigned long* largestDistance
) {
  file->seek(0);
  size_t nbroSavedMeasurements = 0;
  while (
    nbroSavedMeasurements < maxSavedMeasurements
    && readMeasurementFromFile(
      file,
      &measurements[nbroSavedMeasurements]
    )
  ) {
    auto distance = measurements[nbroSavedMeasurements].distanceMM;
    LOGF("[INF|Main] Saved measurement %d: %d mm\n", nbroSavedMeasurements, distance);
    if (distance < *smallestDistance) {
      *smallestDistance = distance;
    }
    if (distance > *largestDistance) {
      *largestDistance = distance;
    }
    nbroSavedMeasurements++;
  }
  return nbroSavedMeasurements;
}

uint8_t transmitMeasurements(Measurement measurements[], size_t nbroMeasurements) {
  LOGLN("[INF|Main] Setting up cellular...");
  setupCellularIO();
  setupCellular();
  LOGLN("[INF|Main] Cellular setup done");

  LOGLN("[INF|Main] Sending HTTP request...");
  Serial1.println("AT+CCHSTART");
  delay(2000);
  while(Serial1.available()) {
    Serial.write(Serial1.read());
  }

  StaticJsonDocument<MAXIMUM_INTER_TRANSMIT_MEASUREMENTS * 64> json;
  
  for (size_t i; i < nbroMeasurements; i++) {
    auto measurement = measurements[i];
    JsonObject measurementJson = json.createNestedObject();
    measurementJson["timeS"] = measurement.timeS;
    measurementJson["distanceMM"] = measurement.distanceMM;
    measurementJson["batteryVoltage"] = measurement.batteryVoltage;
  }

  String jsonString;
  serializeJson(json, jsonString);

  LOGF("[INF|Main] JSON: %s\n", jsonString.c_str());

  String response;
  unsigned long beforeSendMilli = millis();
  uint8_t res = httpPost(
    HTTP_API_BASE_URL "/measurement?"
    // "distanceMM=" + String(currentDistance) +
    // "&batteryVoltage=" + String(batteryVoltage) +
    "token=" HTTP_API_WRITE_TOKEN,
    &jsonString,
    &response,
    10000
  );
  unsigned long afterSendMilli = millis();
  if (res != 0) {
    LOGF("[ERR|Main] HTTP request failed with code %d\n", res);
    return RET_ERROR;
  }

  // Get current time from response
  // Parsing response JSON is a little overkill though
  int nowIndex = response.indexOf("\"now\":");
  int nowEndIndex = _min(
    response.indexOf(",", nowIndex),
    response.indexOf("}", nowIndex)
  );
  String nowString = response.substring(nowIndex + 6, nowEndIndex);
  LOGF("[INF|Main] Got time from response: %s\n", nowString.c_str());
  unsigned long sendDurationMilli = afterSendMilli - beforeSendMilli;
  // Add 1/3 of the send duration to the time because time being a bit late is
  // better than too early
  time_t now = atol(nowString.c_str()) + (sendDurationMilli / 3);
  LOGF("[INF|Main] Setting time to %d\n", now);
  timeval tv = { .tv_sec = now, .tv_usec = 0 };
  settimeofday(&tv, DST_NONE);

  LOGLN("[INF|Main] HTTP request done");
  return RET_OK;
}

void setup() {
  pinMode(LED_BUILTIN, OUTPUT);
  Serial.begin(9600);
  Serial.println("");

  fastBlink(1);

  esp_reset_reason_t reset_reason = esp_reset_reason();
  if (reset_reason == ESP_RST_DEEPSLEEP) {
    LOGLN("[INF|Main] Reset reason: deep sleep");
  } else if (reset_reason == ESP_RST_PANIC) {
    LOGLN("[WRN|Main] Reset reason: panic");
  } else {
    LOGF("[INF|Main] Reset reason: %d\n", reset_reason);
  }

  setupVoltageDividers();

  double usbVoltage = getUsbVoltageAveraged(3);
  LOGF("[INF|Main] USB voltage: %f\n", usbVoltage);
  if (usbVoltage > 4.0) {
    LOGF("[INF|Main] USB power connected, voltage: %f\n", usbVoltage);
    bool cellularIsOn = false;
    checkIfCellularIsOn(5000, &cellularIsOn);
    if (cellularIsOn) {
      LOGF("[INF|Main] Cellular is on. Powering cellular off...\n");
      powerOffCellular();
    }
    LOGF("[INF|Main] Staying awake to charge battery...\n");
    return;
  }

  delay(2);
  double batteryVoltage = getBatteryVoltageAveraged(5);
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

  time_t measurementTime = time(nullptr);
  unsigned long currentDistance = getDistanceMMAveraged(10);
  LOGF("[INF|Main] Distance: %lu mm, time: %d\n", currentDistance, measurementTime);

  LOGF("[INF|Main] Setting up LittleFS...\n");
  if (!LittleFS.begin()){
    LOGF("[ERR|Main] Failed to mount file system. Trying to format...\n");
    if (!LittleFS.format()) {
      LOGF("[ERR|Main] Failed to format file system. Rebooting...\n");
      // TODO: Handle... somehow
      esp_restart();
    }
  }
  if (reset_reason == ESP_RST_PANIC) {
    LOGLN("[INF|Main] Formatting file system out of precaution because of previous panic reset...");
    if (!LittleFS.format()) {
      LOGF("[ERR|Main] Failed to format file system. Rebooting...\n");
      esp_restart();
    }
  }
  LOGF("[INF|Main] LittleFS setup done\n");

  File savedMeasurementsFile = LittleFS.open(SAVED_MEASUREMENTS_FILE_PATH, "a+", true);
  if (!savedMeasurementsFile) {
    LOGF("[ERR|Main] Failed to open saved measurements file. Rebooting...\n");
    esp_restart();
  }
  LOGF("[INF|Main] Saved measurements file size: %d\n", savedMeasurementsFile.size());
  
  // Not including the current measurement
  const auto maxCachedMeasurements = MAXIMUM_INTER_TRANSMIT_MEASUREMENTS - 1;
  auto savedMeasurements = new Measurement[MAXIMUM_INTER_TRANSMIT_MEASUREMENTS];
  
  savedMeasurements[0] = {
    .timeS = static_cast<unsigned long>(measurementTime),
    .distanceMM = currentDistance,
    .batteryVoltage = batteryVoltage
  };
  auto smallestDistance = currentDistance;
  auto largestDistance = currentDistance;
  auto nbroSavedMessages = readSavedMeasurements(
    &savedMeasurementsFile,
    &savedMeasurements[1],
    MAXIMUM_INTER_TRANSMIT_MEASUREMENTS,
    &smallestDistance,
    &largestDistance
  );

  LOGF("[INF|Main] Read %d saved measurements from file\n", nbroSavedMessages);

  auto nbroMessagesToTransit = nbroSavedMessages + 1;

  unsigned long timeOfOldestMeasurement = savedMeasurements[0].timeS;
  unsigned long distanceDelta = _max(
    _abs(currentDistance - smallestDistance),
    _abs(currentDistance - largestDistance)
  );

  LOGF("[INF|Main] Checking if we should transmit...\n");
  bool shouldTransmit = false;
  if (nbroMessagesToTransit >= MAXIMUM_INTER_TRANSMIT_MEASUREMENTS) {
    LOGF("[INF|Main] Transmitting because we have %d measurements (> %d)\n", nbroMessagesToTransit, MAXIMUM_INTER_TRANSMIT_MEASUREMENTS);
    shouldTransmit = true;
  } else if (
    distanceDelta > MAXIMUM_INTER_TRANSMIT_DISTANCE_MM
  ) {
    LOGF("[INF|Main] Transmitting because distance delta is %d mm (> %d)\n", distanceDelta, MAXIMUM_INTER_TRANSMIT_DISTANCE_MM);
    shouldTransmit = true;
  } else if (!timeIsSet()) {
    LOGF("[INF|Main] Transmitting because time is not set\n");
    shouldTransmit = true;
  } else if (millis() > MAXIMUM_INTER_TRANSMIT_TIME_S * 1000) {
    LOGF("[INF|Main] Transmitting because we have been awake for %d seconds (> %d)\n", millis() / 1000, MAXIMUM_INTER_TRANSMIT_TIME_S);
    shouldTransmit = true;
  } else {
    LOGLN("[INF|Main] No need to transmit, saving measurement to flash instead");
  }

  if (shouldTransmit) {
    Serial.println("Transmitting...");
    transmitMeasurements(savedMeasurements, nbroMessagesToTransit);

    LOGF("[INF|Main] Clearing saved measurements file...\n");
    savedMeasurementsFile.close();
    LittleFS.remove(SAVED_MEASUREMENTS_FILE_PATH);

    LOGLN("[INF|Main] Powering off cellular...");
    powerOffCellular();

    for (int i = 0; i < 3; i++) {
      fastBlink(5);
      delay(1000);
    }
  } else {
    Serial.println("Not transmitting");
    LOGF("[INF|Main] Not transmitting\n");
    LOGF("[INF|Main] Saving measurement to file (%d MM, %d S)...\n", currentDistance, measurementTime);
    savedMeasurementsFile.close();
    savedMeasurementsFile = LittleFS.open(SAVED_MEASUREMENTS_FILE_PATH, "a", true);
    savedMeasurementsFile.write((const uint8_t*) &savedMeasurements[0], sizeof(Measurement));
    savedMeasurementsFile.flush();
    savedMeasurementsFile.close();
  }
  LittleFS.end();

  while (true) {
    bool cellularIsOn = false;
    uint32_t cellularOnCheckTimeout = shouldTransmit ? 10000 : 2000;
    checkIfCellularIsOn(cellularOnCheckTimeout, &cellularIsOn);
    if (cellularIsOn) {
      LOGF("[ERR|Main] Cellular is still on. Trying again to turn off...\n");
      powerOffCellular();
      delay(2000);
    } else {
      LOGLN("[INF|Main] Confirmed cellular is off.");
      break;
    }
  }

  unsigned long sleepTimeS = 60 * 60;
  // unsigned long sleepTimeS = 10;
  LOGF("[INF|Main] Getting sleepy... Dozing off for %d seconds...\n", sleepTimeS);
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

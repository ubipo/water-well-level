#include <Arduino.h>
#include "common_macros.h"
#include "stream_extensions.h"
#include "fast_blink.h"
#include "cellular.h"


unsigned char sendNoResponseCommand(Stream* modemStream, String command) {
  modemStream->println(command);
  String atResponseLine;
  unsigned char ret;
  OK_OR_RETURN(readEmptyLine(modemStream));
  OK_OR_RETURN(readLine(modemStream, &atResponseLine));
  if (atResponseLine.indexOf("OK") >= 0) {
    LOGLN("Status OK");
    return AT_OK_STATUS;
  } else if (atResponseLine.indexOf("ERROR") >= 0) {
    LOGLN("Status ERROR");
    return AT_ERROR_STATUS;
  }
  LOGLN("Error receiving AT status.");
  return ERROR_RECEIVING_AT_STATUS;
}

unsigned char sendStatusAndTextResponseCommand(
  Stream* modemStream, String command, String* textResponse
) {
  modemStream->println(command);
  *textResponse = modemStream->readStringUntil('\n');
  if (textResponse->indexOf("ERROR") >= 0) {
    return AT_ERROR_STATUS;
  }
  String statusResponse = modemStream->readStringUntil('\n');
  if (statusResponse.indexOf("OK") >= 0) {
    return AT_OK_STATUS;
  }
  return ERROR_RECEIVING_AT_STATUS;
}

String sendData(String command, const int timeout, boolean debug)
{
  String response = "";
  Serial1.println(command);

  unsigned long time = millis();
  while ((time + timeout) > millis())
  {
      while (Serial1.available())
      {
          char c = Serial1.read();
          response += c;
      }
  }
  if (debug)
  {
    Serial.print("Response: ");
    Serial.println(response);
  }
  return response;
}

void sendSMS() {
  Serial.println("Sending SMS...");
  sendData("AT+CMGF=1", 3000, DEBUG);
  delay(200);
  sendData("AT+CMGS=\"+32470084039\"", 3000, DEBUG);
  delay(200);
  sendData("Hello from Arduino!", 3000, DEBUG);
  delay(200);
  sendData("\x1A", 3000, DEBUG);
  delay(200);
  Serial.println("SMS sent.");
}

bool tryDisableEcho(unsigned long timeout) {
  unsigned long streamTimeoutBackup = Serial1.getTimeout();
  unsigned long startTime = millis();
  while (millis() - startTime < timeout) {
    Serial1.println("ATE0");
    Serial1.setTimeout(min(timeout - (millis() - startTime), (unsigned long) 200));
    String response = Serial1.readStringUntil('\n');
    if (response.indexOf("OK") >= 0) {
      Serial1.setTimeout(streamTimeoutBackup);
      return true;
    }
    if (response.indexOf("ATE0") >= 0) {
      Serial1.setTimeout(streamTimeoutBackup);
      return true;
    }
  }
  return false;
}

String CREG_RESPONSE_LINE_PREFIX = F("+CREG: ");

#define CREG_STATUS_REGISTERED_HOME 1
#define CREG_STATUS_REGISTERED_ROAMING 5

bool isCregResponseIndicatingNetworkRegistration(String response) {
  if (response.indexOf(CREG_RESPONSE_LINE_PREFIX) >= 0) {
    response.remove(0, CREG_RESPONSE_LINE_PREFIX.length());
    unsigned int secondArgIndex = response.indexOf(',');
    if (secondArgIndex < 0) {
      // LOGLN("CREG response has no comma after first argument.");
      LOGLN("[ERR|Cellular/NetworkRegistration] CREG response has no comma after first argument.");
      return false;
    }
    unsigned int thirdArgIndex = response.indexOf(',', secondArgIndex + 1);
    if (thirdArgIndex < 0) {
      thirdArgIndex = response.length();
    }
    unsigned int status = response.substring(secondArgIndex + 1, thirdArgIndex).toInt();
    if (status == CREG_STATUS_REGISTERED_HOME) {
      LOGLN("[INF|Cellular/NetworkRegistration] CREG status: registered home (" STRINGIFY(CREG_STATUS_REGISTERED_HOME) ")");
      return true;
    } else if (status == CREG_STATUS_REGISTERED_ROAMING) {
      LOGLN("[INF|Cellular/NetworkRegistration] CREG status: registered roaming (" STRINGIFY(CREG_STATUS_REGISTERED_ROAMING) ")");
      return true;
    }
    LOGF("[INF|Cellular/NetworkRegistration] CREG status: not registered (%d)\n", status);
  }
  LOGF(
    "[ERR|Cellular/NetworkRegistration] CREG response line does not start with \"%s\"\n",
    CREG_RESPONSE_LINE_PREFIX.c_str()
  );
  return false;
}

#define DEFAULT_NETWORK_REGISTRATION_TIMEOUT 30000

unsigned char waitUntilCellularNetworkRegistered(
  unsigned long timeout = DEFAULT_NETWORK_REGISTRATION_TIMEOUT
) {
  unsigned long startTime = millis();
  while (millis() - startTime < timeout) {
    fastBlink(3);
    Serial1.println("AT+CREG?");
    String response;
    unsigned char ret = readLine(&Serial1, &response);
    if (ret != RET_OK) {
      LOGLN("[ERR|Cellular/NetworkRegistration] CREG: error reading response");
      continue;
    }
    if (response.length() == 0) {
      readLine(&Serial1, &response);
    }
    if (response.indexOf("ERROR") >= 0) {
      LOGLN("[ERR|Cellular/NetworkRegistration] CREG: AT error");
    } else if (isCregResponseIndicatingNetworkRegistration(response)) {
      return RET_OK;
    }
    LOGLN("[INF|Cellular/NetworkRegistration] Not registered, retrying in 700 ms...");
    LOGLN("[INF|Cellular/NetworkRegistration] \\/ \\/ Flushing UART buffer... \\/\\/");
    unsigned long flushStartTime = millis();
    while (millis() - flushStartTime < 1000) {
      while (Serial1.available()) {
        Serial.write(Serial1.read());
      }
    }
    LOGLN("[INF|Cellular/NetworkRegistration] /\\ /\\ UART buffer flushed /\\/");
  }
  return RET_TIMEOUT;
}



void powerOffCellular() {
  pinMode(PIN_CELLULAR_PWR, OUTPUT);
  // Pulse high for at least 2.5 seconds
  digitalWrite(PIN_CELLULAR_PWR, HIGH);
  delay(3000);
  digitalWrite(PIN_CELLULAR_PWR, LOW);
  // Wait for 1.9 seconds to power off + 2 seconds buffer
  delay(2700);
  // Keeping POWERKEY HIGH seems to be necessary to prevent the module from
  // powering on again. Don't know why.
  digitalWrite(PIN_CELLULAR_PWR, HIGH);
  delay(1000);
  // pinMode(PIN_CELLULAR_PWR, INPUT);
}

void powerOnCellular() {
  // Go back to LOW in case POWERKEY was HIGH because of explicit power off
  pinMode(PIN_CELLULAR_PWR, OUTPUT);
  digitalWrite(PIN_CELLULAR_PWR, LOW);
  delay(100);
  // Pulse low for 50ms
  digitalWrite(PIN_CELLULAR_PWR, HIGH);
  delay(50);
  digitalWrite(PIN_CELLULAR_PWR, LOW);
  // Wait for power on (should verify with AT command after)
  delay(500);
}

void rebootCellular() {
  powerOffCellular();
  powerOnCellular();
}

bool tryCellularUARTSetup() {
  // Power on to UART ready can take up to 11 seconds (A7600E_Hardware
  // Design_V1.00)
  // In reality it seems to vary up to even 25 seconds?
  // In any case, wait for quite a while to be sure and prevent a restart loop.
  if (!tryDisableEcho(35000)) {
    LOGLN("[ERR|Cellular] Could not disable echo");
    return false;
  }
  LOGLN("[INF|Cellular] Echo disabled");
  fastBlink(2);

  if (false) {
    if (sendNoResponseCommand(&Serial1, "AT+CPIN=3653") != AT_OK_STATUS) {
      LOGLN("[ERR|Cellular] Error entering PIN");
      return false;
    }
  } else {
    LOGLN("[INF|Cellular] Did not enter PIN");
  }

  LOGLN("[INF|Cellular] Waiting for network registration...");
  unsigned char ret = waitUntilCellularNetworkRegistered();
  if (ret != RET_OK) {
    LOGLN("[ERR|Cellular] Error waiting for network registration");
    return false;
  }
  LOGLN("[INF|Cellular] Network registered");
  fastBlink(3);

  return true;
}

void setupCellularIO() {
  pinMode(PIN_CELLULAR_PWR, OUTPUT);
  digitalWrite(PIN_CELLULAR_PWR, LOW);
  Serial1.begin(115200);
}

void setupCellular() {
  powerOnCellular();
  Serial.println("[INF|Cellular] Signaled cellular module to power on");
  fastBlink(1);

  while (1) {
    if (tryCellularUARTSetup()) {
      break;
    }
    LOGLN("[ERR|Cellular] Error setting up cellular module over UART, rebooting module...");
    rebootCellular();
  }
}

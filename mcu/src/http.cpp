#include "Arduino.h"
#include "common_macros.h"
#include "stream_extensions.h"
#include "cellular.h"


String HTTP_RESPONSE_STATUS_LINE_PREFIX = F("+HTTPACTION: ");

unsigned char httpGetDemo() {
  Serial.println("Sending HTTP GET request...");
  delay(1000);
  while (Serial1.available()) {
    Serial1.read();
  }
  Serial.println("Maybe terminating HTTP service from previous request...");
  if (sendNoResponseCommand(&Serial1, "AT+HTTPTERM") == ERROR_RECEIVING_AT_STATUS) {
    Serial.println("Error terminating HTTP service.");
    return RET_OK;
  }
  Serial.println("Initializing HTTP service...");
  if (sendNoResponseCommand(&Serial1, "AT+HTTPINIT") != AT_OK_STATUS) {
    Serial.println("Error initializing HTTP service.");
    return RET_OK;
  }
  Serial.println("Setting HTTP parameters...");
  String url = String("http://water.requestcatcher.com/");
  if (sendNoResponseCommand(&Serial1, "AT+HTTPPARA=\"URL\",\"" + url + "\"") != AT_OK_STATUS) {
    Serial.println("Error setting URL.");
    return RET_OK;
  }
  Serial.println("Setting HTTP action...");
  if (sendNoResponseCommand(&Serial1, "AT+HTTPACTION=0") != AT_OK_STATUS) {
    Serial.println("Error sending HTTP action.");
    return RET_OK;
  }
  String httpResponseStatusLine;
  unsigned char ret;
  OK_OR_RETURN(readEmptyLine(&Serial1));
  readLine(&Serial1, &httpResponseStatusLine);
  if (httpResponseStatusLine.indexOf(HTTP_RESPONSE_STATUS_LINE_PREFIX) != 0) {
    LOGF("Expected HTTP response status line, got \"%s\"\n", httpResponseStatusLine.c_str());
    return RET_OK;
  }
  httpResponseStatusLine.remove(0, HTTP_RESPONSE_STATUS_LINE_PREFIX.length());
  int httpStatuesArgIndex = httpResponseStatusLine.indexOf(',');
  int lengthArgIndex = httpResponseStatusLine.indexOf(',', httpStatuesArgIndex + 1);
  int httpStatus = httpResponseStatusLine.substring(httpStatuesArgIndex + 1, lengthArgIndex).toInt();
  int dataLength = httpResponseStatusLine.substring(lengthArgIndex + 1).toInt();
  LOGF("HTTP status: %d, data length: %d\n", httpStatus, dataLength);
  if (sendNoResponseCommand(&Serial1, "AT+HTTPREAD=" + String(dataLength)) != AT_OK_STATUS) {
    Serial.println("Error reading HTTP response data.");
    return RET_OK;
  }
  String httpReadResponseLine;
  OK_OR_RETURN(readEmptyLine(&Serial1));
  ret = readLine(&Serial1, &httpReadResponseLine);
  LOGF("HTTP read response line: \"%s\"\n", httpReadResponseLine.c_str());
  if (ret != RET_OK) {
    Serial.println("Error reading HTTP response data.");
    return RET_OK;
  }
  char httpResponseBody[dataLength + 1];
  httpResponseBody[dataLength] = '\0';
  ret = readExactly(&Serial1, httpResponseBody, dataLength);
  if (ret != RET_OK) {
    Serial.println("Error reading HTTP response data.");
    return RET_OK;
  }
  LOGF("HTTP response body: \"%s\"\n", httpResponseBody);
  OK_OR_RETURN(readEmptyLine(&Serial1));
  ret = readLine(&Serial1, &httpReadResponseLine);
  LOGF("HTTP read response line: \"%s\"\n", httpReadResponseLine.c_str());
  if (ret != RET_OK) {
    Serial.println("Error reading HTTP response data.");
    return RET_OK;
  }
  if (sendNoResponseCommand(&Serial1, "AT+HTTPTERM") != AT_OK_STATUS) {
    Serial.println("Error terminating HTTP service.");
    return RET_OK;
  }
  Serial.println("HTTP GET request sent.");
}

unsigned char httpGet(
    String url,
    String* response,
    unsigned long timeout
) {
    delay(1000);
    while (Serial1.available()) {
        Serial1.read();
    }
    LOGF("[INF|Cellular/HTTP] Sending HTTP POST request to \"%s\"...\n", url.c_str());
    LOGF("[INF|Cellular/HTTP] Maybe terminating HTTP service from previous request...\n");
    if (sendNoResponseCommand(&Serial1, "AT+HTTPTERM") == ERROR_RECEIVING_AT_STATUS) {
        LOGF("[ERR|Cellular/HTTP] Error terminating HTTP service.\n");
        return RET_ERROR;
    }
    unsigned char ret;
    LOGF("[INF|Cellular/HTTP] Initializing HTTP service...\n");
    OK_OR_RETURN(sendNoResponseCommand(&Serial1, "AT+HTTPINIT"));
    LOGLN("[INF|Cellular/HTTP] HTTP service initialized.");
    OK_OR_RETURN(sendNoResponseCommand(&Serial1, "AT+HTTPPARA=\"URL\",\"" + url + "\""));
    LOGLN("[INF|Cellular/HTTP] HTTP parameters set.");
    OK_OR_RETURN(sendNoResponseCommand(&Serial1, "AT+HTTPACTION=0"));
    LOGLN("[INF|Cellular/HTTP] HTTP action sent.");
    OK_OR_RETURN(readEmptyLine(&Serial1));
    LOGLN("[INF|Cellular/HTTP] Reading HTTP response status line...");
    String httpResponseStatusLine;
    OK_OR_RETURN(readLine(&Serial1, &httpResponseStatusLine));
    if (httpResponseStatusLine.indexOf(HTTP_RESPONSE_STATUS_LINE_PREFIX) != 0) {
        LOGF("[ERR|Cellular/HTTP] Expected HTTP response status line, got \"%s\"\n", httpResponseStatusLine.c_str());
        return RET_ERROR;
    }
    httpResponseStatusLine.remove(0, HTTP_RESPONSE_STATUS_LINE_PREFIX.length());
    int httpStatusArgIndex = httpResponseStatusLine.indexOf(',');
    int lengthArgIndex = httpResponseStatusLine.indexOf(',', httpStatusArgIndex + 1);
    int httpStatus = httpResponseStatusLine.substring(httpStatusArgIndex + 1, lengthArgIndex).toInt();
    int dataLength = httpResponseStatusLine.substring(lengthArgIndex + 1).toInt();
    LOGF("[INF|Cellular/HTTP] HTTP status: %d, data length: %d\n", httpStatus, dataLength);
    OK_OR_RETURN(sendNoResponseCommand(&Serial1, "AT+HTTPREAD=" + String(dataLength)));
    OK_OR_RETURN(readEmptyLine(&Serial1));
    OK_OR_RETURN(readLine(&Serial1, &httpResponseStatusLine));
    LOGF("[INF|Cellular/HTTP] HTTP read response line: \"%s\"\n", httpResponseStatusLine.c_str());
    char httpResponseBody[dataLength + 1];
    httpResponseBody[dataLength] = '\0';
    OK_OR_RETURN(readExactly(&Serial1, httpResponseBody, dataLength));
    LOGF("[INF|Cellular/HTTP] HTTP response body: \"%s\"\n", httpResponseBody);
    OK_OR_RETURN(readEmptyLine(&Serial1));
    OK_OR_RETURN(readLine(&Serial1, &httpResponseStatusLine));
    LOGF("[INF|Cellular/HTTP] HTTP read response line: \"%s\"\n", httpResponseStatusLine.c_str());
    OK_OR_RETURN(sendNoResponseCommand(&Serial1, "AT+HTTPTERM"));
    LOGF("[INF|Cellular/HTTP] HTTP POST request sent.\n");
    *response = String(httpResponseBody);
    return RET_OK;
}

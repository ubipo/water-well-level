#include <Arduino.h>
#include "common_macros.h"

// Private method copied from Stream.cpp
unsigned char timedRead(
  Stream* stream,
  char* c,
  unsigned long timeout = DEFAULT_TIMEOUT
) {
  unsigned long startMillis = millis();
  do {
    *c = stream->read();
    if(*c >= 0) {
      return RET_OK;
    }
  } while(millis() - startMillis < timeout);
  LOGF("Timeout after %lu ms in timedRead\n", timeout);
  return RET_TIMEOUT;
}

unsigned char readStringUntil(
  Stream* stream,
  char terminator,
  String* result,
  unsigned long timeout = DEFAULT_TIMEOUT
) {
  *result = "";
  int c;
  unsigned long startMillis = millis();
  do {
    c = stream->read();
    if (c >= 0) {
      if (c == terminator) {
        return RET_OK;
      }
      *result += (char) c;
    }
  } while (millis() - startMillis < timeout);
  LOGF("Timeout after %lu ms in readStringUntil. Read so far: \"%s\"\n", timeout, result->c_str());
  return RET_TIMEOUT;
}

unsigned char readLine(
  Stream* stream,
  String* line,
  unsigned long timeout = DEFAULT_TIMEOUT
) {
  unsigned char ret = readStringUntil(stream, '\n', line, timeout);
  if (ret != RET_OK) return ret;
  if (line->length() > 0 && line->charAt(line->length() - 1) == '\r') {
    line->remove(line->length() - 1);
  }
  return RET_OK;
}

unsigned char readEmptyLine(
  Stream* stream,
  unsigned long timeout = DEFAULT_TIMEOUT
) {
  String line;
  unsigned char ret = readLine(stream, &line, timeout);
  if (ret != RET_OK) return ret;
  if (line.length() != 0) {
    LOGF("Expected empty line, got \"%s\"\n", line.c_str());
    return RET_ERROR;
  }
  return RET_OK;
}

unsigned char readExactly(
  Stream* stream,
  char* buffer,
  int length,
  unsigned long timeout = DEFAULT_TIMEOUT
) {
  unsigned long startMillis = millis();
  int i = 0;
  while (i < length) {
    unsigned char ret = timedRead(stream, buffer + i, timeout);
    if (ret != RET_OK) return ret;
    i++;
  }
  return RET_OK;
}

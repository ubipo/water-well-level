#pragma once

#include <Arduino.h>
#include "common_macros.h"


unsigned char timedRead(
  Stream* stream,
  char* c,
  unsigned long timeout = DEFAULT_TIMEOUT
);

unsigned char readStringUntil(
  Stream* stream,
  char terminator,
  String* result,
  unsigned long timeout = DEFAULT_TIMEOUT
);

unsigned char readLine(
  Stream* stream,
  String* line,
  unsigned long timeout = DEFAULT_TIMEOUT
);

unsigned char readEmptyLine(
  Stream* stream,
  unsigned long timeout = DEFAULT_TIMEOUT
);

unsigned char readExactly(
  Stream* stream,
  char* buffer,
  int length,
  unsigned long timeout = DEFAULT_TIMEOUT
);

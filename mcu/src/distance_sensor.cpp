#include <Arduino.h>
#include "common_macros.h"


#define PIN_TRIGGER A5
#define PIN_ECHO A4

#define DISTANCE_CORRECTION 0.0

void setupDistanceSensor() {
  pinMode(PIN_TRIGGER, OUTPUT);
  pinMode(PIN_ECHO, INPUT);
}

unsigned long getPulseTime() {
  digitalWrite(PIN_TRIGGER, LOW);
  delayMicroseconds(2);
  digitalWrite(PIN_TRIGGER, HIGH);
  delayMicroseconds(10);
  digitalWrite(PIN_TRIGGER, LOW);
  return pulseIn(PIN_ECHO, HIGH);
}

unsigned long getDistanceMM() {
  unsigned long pulseTime = getPulseTime();
  unsigned long distance = ((pulseTime * 0.344) / 2) + DISTANCE_CORRECTION;
  return distance;
}

unsigned long getDistanceMMAveraged(
    unsigned char count
) {
  unsigned long long sum = 0;
  for (unsigned char i = 0; i < count; i++) {
    sum += getDistanceMM();
    delay(10);
  }
  return sum / count;
}

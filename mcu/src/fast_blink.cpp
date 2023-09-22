#include <Arduino.h>


void fastBlink(unsigned char count) {
  for (unsigned char i = 0; i < count; i++) {
    digitalWrite(LED_BUILTIN, HIGH);
    delay(200);
    digitalWrite(LED_BUILTIN, LOW);
    delay(200);
  }
  delay(700);
}

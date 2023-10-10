#pragma once


#include "common_macros.h"

unsigned char httpGetDemo();
unsigned char httpGet(
    String url,
    String* response,
    unsigned long timeout = DEFAULT_TIMEOUT
);
unsigned char httpPost(
    String url,
    String* body,
    String* response,
    unsigned long timeout = DEFAULT_TIMEOUT
);

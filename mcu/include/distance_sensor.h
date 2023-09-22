#pragma once


#define AVERAGED_DISTANCE_COUNT_DEFAULT 5

void setupDistanceSensor();
unsigned long getDistanceMMAveraged(
    unsigned char count = AVERAGED_DISTANCE_COUNT_DEFAULT
);

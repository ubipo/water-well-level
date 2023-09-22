#pragma once


#define PIN_CELLULAR_PWR 3

#define AT_OK_STATUS 0
#define AT_ERROR_STATUS 1
#define ERROR_RECEIVING_AT_STATUS 2

unsigned char sendNoResponseCommand(Stream* modemStream, String command);
void setupCellularIO();
void setupCellular();
void powerOnCellular();
void powerOffCellular();
void rebootCellular();

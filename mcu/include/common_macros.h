#pragma once


#define STRINGIFY2(X) #X
#define STRINGIFY(X) STRINGIFY2(X)

#define DEBUG false
#define LOGLN(x) if (DEBUG) Serial.println(x)
#define LOGF(...) if (DEBUG) Serial.printf(__VA_ARGS__)

#define RET_OK 0
#define OK_OR_RETURN(x) ret = x; if (ret != RET_OK) return ret;
#define RET_ERROR 1
#define RET_TIMEOUT 2

#define DEFAULT_TIMEOUT 20000

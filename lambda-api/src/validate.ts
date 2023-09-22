import { Config } from "./config";
import { nowS } from "./time";


type ValidateResult<T> = [T, null] | [null, string];

export function validateDistance(config: Config, distanceMM: any): ValidateResult<number> {
  const distanceMMNum = Number(distanceMM);
  if (!Number.isFinite(distanceMMNum)) {
    return [null, `not finite`]
  }
  if (!(distanceMMNum >= 0)) {
    return [null, `negative`]
  }
  if (!(distanceMMNum <= config.sensorDistanceFromBottomMM)) {
    return [null, `too large: > ${config.sensorDistanceFromBottomMM})`]
  }
  return [distanceMMNum, null]
}

export function validateTime(timeS: any): ValidateResult<number> {
  const timeSNum = Math.floor(timeS);
  if (!Number.isFinite(timeSNum)) {
    return [null, `not finite`]
  }
  if (timeSNum < 0) {
    return [null, `negative`];
  }
  const maxTime = nowS() + 1 * 60;
  if (timeSNum > maxTime) {
    return [null, `too large: > ${maxTime}`]
  }
  return [timeSNum, null]
}

export function validateBatteryVoltage(batteryVoltage: any): ValidateResult<number | null> {
  if (["number", "string"].includes(typeof batteryVoltage)) {
    const batteryVoltageNum = Number(batteryVoltage);
    if (!Number.isFinite(batteryVoltageNum)) {
      return [null, `not finite`]
    }
    if (batteryVoltageNum < 1) {
      return [null, `too small: < 1`]
    }
    if (batteryVoltageNum > 5) {
      return [null, `too large: > 5`]
    }
    return [batteryVoltageNum, null]
  }
  return [null, null]
}

import { createRequestInit, getApiBaseUrl } from "./fetch"
import { Instant, ZonedDateTime, getUserTimeZone } from "./temporal"

interface MeasurementFromApi {
  waterLevelMM: number
  timeS: number
  batteryVoltage: number | undefined
}

interface Measurement extends MeasurementFromApi {
  dateTime: ZonedDateTime
}

export type { Measurement }

export function isMeasurementFromApi(
  measurement: any
): measurement is MeasurementFromApi {
  return typeof measurement === "object" && measurement !== null &&
    typeof measurement.waterLevelMM === "number" &&
    typeof measurement.timeS === "number" &&
    (typeof measurement.batteryVoltage === "number" || measurement.batteryVoltage === undefined)
}

export function isMeasurementsFromApiArray(
  measurements: any
): measurements is MeasurementFromApi[] {
  return Array.isArray(measurements) && measurements.every(isMeasurementFromApi)
}

export async function fetchMeasurements(password: string) {
  const measurementsResult = await fetch(
    `${getApiBaseUrl()}/measurement`,
    createRequestInit(password)
  )
  if (!measurementsResult.ok) {
    throw new Error(
      `Failed to fetch measurements: ${measurementsResult.status} ${measurementsResult.statusText}`
    )
  }
  const measurements = await measurementsResult.json()
  if (!isMeasurementsFromApiArray(measurements)) {
    throw new Error(`Expected API to return an array of measurements, got: ${JSON.stringify(measurements)}`)
  }
  measurements.sort((a, b) => a.timeS - b.timeS)
  return measurements.map(measurement => ({
    ...measurement,
    dateTime: Instant.fromEpochSeconds(measurement.timeS).toZonedDateTimeISO(getUserTimeZone()),
  } as Measurement))
}

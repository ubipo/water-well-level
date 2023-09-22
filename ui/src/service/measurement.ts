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
  const measurements = await measurementsResult.json() as MeasurementFromApi[]
  measurements.sort((a, b) => a.timeS - b.timeS)
  return measurements.map(measurement => ({
    ...measurement,
    dateTime: Instant.fromEpochSeconds(measurement.timeS).toZonedDateTimeISO(getUserTimeZone()),
  } as Measurement))
}

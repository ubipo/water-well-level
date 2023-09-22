import { createRequestInit, getApiBaseUrl } from "./fetch"


export const HUMAN_READABLE_CONFIG_NAMES: Record<string, string> = {
  "sensorDistanceFromBottomMM": "Sensor distance from bottom (mm)",
  "readAuthorizationToken": "Read authorization token",
  "writeAuthorizationToken": "Write authorization token",
  "lowerThresholdMM": "Lower threshold (mm)",
  "upperThresholdMM": "Upper threshold (mm)",
  "fastDropAmountMM": "Fast drop amount (mm)",
  "fastDropTimeS": "Fast drop time window (s)",
  "fastRiseAmountMM": "Fast rise amount (mm)",
  "fastRiseTimeS": "Fast rise time window (s)",
}

export type Config = Record<keyof typeof HUMAN_READABLE_CONFIG_NAMES, { unit: string, value: any }>

export async function fetchConfig(password: string) {
  const configResult = await fetch(
    `${getApiBaseUrl()}/config`,
    createRequestInit(password),
  )
  if (!configResult.ok) {
    throw new Error(
      `Failed to fetch config: ${configResult.status} ${configResult.statusText}`
    )
  }
  return await configResult.json() as Config
}

export async function updateConfigValue(password: string, key: string, value: any) {
  const requestInit = createRequestInit(password)
  requestInit.method = "POST"
  requestInit.body = JSON.stringify({ key, value })
  const configResult = await fetch(
    `${getApiBaseUrl()}/config/${key}`,
    requestInit,
  )
  if (!configResult.ok) {
    throw new Error(
      `Failed to fetch config: ${configResult.status} ${configResult.statusText}`
    )
  }
}

import { getDynamo } from "./awsClients"
import { envStringOrThrow } from "./env"
import { PutCommand, ScanCommand } from "@aws-sdk/lib-dynamodb"


function getConfigTableName() {
  return envStringOrThrow("DYNAMODB_CONFIG_TABLE_NAME")
}

function generateRandomToken() {
  return Array.from(
    Array(20),
    () => Math.floor(Math.random() * 36).toString(36)
  ).join('')
}

// Wether the field is visible to the user
const INTERNAL = 1 << 0
// Wether the field is send to the deployed IoT device
const FIELD_DEPLOYED_READABLE = 1 << 1

function c(unit: string, defaultValue: any, flags = 0) {
  const userChangeable = (flags & INTERNAL) !== 0
  const fieldDeployedReadable = (flags & FIELD_DEPLOYED_READABLE) !== 0
  return { unit, defaultValue, userChangeable, fieldDeployedReadable }
}

export const CONFIG_KEYS_CONFIG = {
  "sensorDistanceFromBottomMM": c("mm", 5000),
  "measurementIntervalS": c("s", 60 * 60, FIELD_DEPLOYED_READABLE),
  "numberOfMeasurementsToSkipBetweenUploads": c("naturalNumber", 0, FIELD_DEPLOYED_READABLE),
  "readAuthorizationToken": c("text", generateRandomToken),
  "writeAuthorizationToken": c("text", generateRandomToken),
  "lowerThresholdMM": c("mm", 0),
  "upperThresholdMM": c("mm", Number.MAX_SAFE_INTEGER),
  "thresholdMinimumNotificationIntervalS": c("s", 3 * 60 * 60),
  "fastDropAmountMM": c("mm", Number.MAX_SAFE_INTEGER),
  "fastDropTimeS": c("s", 0),
  "fastRiseAmountMM": c("mm", Number.MAX_SAFE_INTEGER),
  "fastRiseTimeS": c("s", 0),
  "lastThresholdNotificationS": c("s", 0, INTERNAL),
}
export type ConfigKey = keyof typeof CONFIG_KEYS_CONFIG
export type Config = Record<ConfigKey, any>

export function parseUnitValue(unit: string, value: any) {
  if (["mm", "s", "naturalNumber"].includes(unit)) {
    return Number(value)
  } else if (unit === "text") {
    return String(value)
  } else {
    throw new Error(`Unknown unit: ${unit}`)
  }
}

export async function updateConfigItem(
  config: Config,
  key: ConfigKey,
  value: any
) {
  await getDynamo().send(
    new PutCommand({
      TableName: getConfigTableName(),
      Item: { hash: key, key, value },
    })
  );
  config[key] = value;
}

export async function createConfig() {
  const configItems = (await getDynamo().send(
    new ScanCommand({ TableName: getConfigTableName() })
  )).Items
  const config: Config = configItems == null
    ? {}
    : Object.fromEntries(configItems.map(item => [item.key, item.value]));
  const updates = Object.entries(CONFIG_KEYS_CONFIG).map(([key, { defaultValue }]) => {
    if (config[key as ConfigKey] == null) {
      console.log(`Setting default value for ${key}`)
      const newValue = typeof defaultValue === "function" ? defaultValue() : defaultValue;
      return updateConfigItem(config, key as ConfigKey, newValue);
    }
    return null;
  }).filter(x => x != null);
  await Promise.all(updates);
  return config;
}

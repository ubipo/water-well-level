import { APIGatewayProxyEventV2 } from "aws-lambda";
import { HttpBadRequestError, HttpNotFoundError, HttpUnauthorizedError, RouteHandlerRegistrar } from "./RouteHandlerRegistrar";
import { getDataTableName, getDynamo } from "./awsClients";
import { validateBatteryVoltage, validateDistance, validateTime } from "./validate";
import { nowS } from "./time";
import { Measurement, publishMeasurement } from "./measurement";
import { CONFIG_KEYS_CONFIG, ConfigKey, parseUnitValue, updateConfigItem } from "./config";
import { PutCommand, ScanCommand } from "@aws-sdk/lib-dynamodb";


const BEARER_PREFIX = "Bearer ";

function bearerTokenMatches(
  event: APIGatewayProxyEventV2,
  targetToken: string
) {
  const authorization = event.headers.authorization;
  if (!(typeof authorization === "string" && authorization.length > 0)) {
    return false
  }
  if (!authorization.startsWith(BEARER_PREFIX)) {
    return false
  }
  const eventToken = authorization.slice(BEARER_PREFIX.length);
  return eventToken === targetToken;
}

const registrar = new RouteHandlerRegistrar()
registrar
.get("/measurement", async (event, getConfig) => {
  const config = await getConfig()
  console.log('Checking bearer token')
  console.log(config.readAuthorizationToken)
  console.log(event)
  if (!bearerTokenMatches(event, config.readAuthorizationToken)) {
    throw new HttpUnauthorizedError()
  }
  const res = await getDynamo().send(
    new ScanCommand({ TableName: getDataTableName() })
  );
  return res.Items;
})
.get("/postMeasurementFallback", async (event, getConfig) => {
  const config = await getConfig();
  const params = event.queryStringParameters ?? {};
  if (params.token !== config.writeAuthorizationToken) {
    throw new HttpUnauthorizedError()
  }
  const [distanceMM, distanceInvalid] = validateDistance(config, params.distanceMM)
  if (distanceInvalid != null) {
    throw new HttpBadRequestError(`distanceMM ${distanceInvalid}, got ${distanceMM}`)
  }
  const waterLevelMM = config.sensorDistanceFromBottomMM - distanceMM;
  console.info(`Received distanceMM=${distanceMM}. sensorDistanceFromBottomMM=${config.sensorDistanceFromBottomMM} => waterLevelMM=${waterLevelMM}`)
  const [batteryVoltage, batteryVoltageInvalid] = validateBatteryVoltage(params.batteryVoltage)
  if (batteryVoltageInvalid != null) {
    throw new HttpBadRequestError(`batteryVoltage ${batteryVoltageInvalid}, got ${batteryVoltage}`)
  }
  const time = nowS();
  const measurement: Measurement = { hash: time, timeS: time, waterLevelMM, batteryVoltage }
  await publishMeasurement(config, measurement);
  return measurement;
})
.post("/measurement", async (event, getConfig) => {
  const config = await getConfig();
  if (!bearerTokenMatches(event, config.writeAuthorizationToken)) {
    throw new HttpUnauthorizedError()
  }
  const body = event.body;
  if (body == null) {
    throw new HttpBadRequestError("No body")
  }
  let bodyJson: any
  try { bodyJson = JSON.parse(body) }
  catch (e) { if (e instanceof SyntaxError) {
    throw new HttpBadRequestError(`Invalid JSON: ${e.message}`)
  } else { throw e } }
  const [timeS, timeInvalid] = validateTime(bodyJson.timeS)
  if (timeInvalid != null) {
    throw new HttpBadRequestError(`time ${timeInvalid}, got ${bodyJson.timeS}`)
  }
  const [distanceMM, distanceInvalid] = validateDistance(config, bodyJson.distanceMM)
  if (distanceInvalid != null) {
    throw new HttpBadRequestError(`distanceMM ${distanceInvalid}, got ${bodyJson.distanceMM}`)
  }
  const waterLevelMM = config.sensorDistanceFromBottomMM - distanceMM;
  const [batteryVoltage, batteryVoltageInvalid] = validateBatteryVoltage(bodyJson.batteryVoltage)
  if (batteryVoltageInvalid != null) {
    throw new HttpBadRequestError(`batteryVoltage ${batteryVoltageInvalid}, got ${bodyJson.batteryVoltage}`)
  }
  const measurement: Measurement = { hash: timeS, timeS: timeS, waterLevelMM, batteryVoltage }
  await publishMeasurement(config, measurement);
  return measurement
})
.get("/config", async (event, getConfig) => {
  const config = await getConfig();
  if (!bearerTokenMatches(event, config.readAuthorizationToken)) {
    throw new HttpUnauthorizedError()
  }
  const clientSideConfig = Object.fromEntries(
    Object.entries(CONFIG_KEYS_CONFIG)
      .filter(([_, { userChangeable }]) => userChangeable)
      .map(([key, { unit }]) => {
        const value = config[key as ConfigKey];
        return [key, { unit, value }]
      })
  )
  return clientSideConfig
})
.post((e) => e.requestContext.http.path.startsWith("/config"), async (event, getConfig) => {
  const config = await getConfig();
  if (!bearerTokenMatches(event, config.readAuthorizationToken)) {
    throw new HttpUnauthorizedError()
  }
  const configKey = event.requestContext.http.path.slice("/config/".length) as ConfigKey
  const configKeyConfig = CONFIG_KEYS_CONFIG[configKey]
  if (configKeyConfig == null) {
    throw new HttpNotFoundError(`No such config key: ${configKey}`);
  }
  const { unit } = configKeyConfig;
  const body = event.body;
  if (body == null) {
    throw new HttpBadRequestError("No body")
  }
  let bodyJson: any
  try { bodyJson = JSON.parse(body) }
  catch (e) { if (e instanceof SyntaxError) {
    throw new HttpBadRequestError(`Invalid JSON: ${e.message}`)
  } else { throw e } }
  const value = parseUnitValue(unit, bodyJson.value)
  await updateConfigItem(config, configKey, value);
  return { key: configKey, value };
})
.post("/populate", async (event, getConfig) => {
  const config = await getConfig();
  if (!bearerTokenMatches(event, config.writeAuthorizationToken)) {
    throw new HttpUnauthorizedError()
  }
  const currentTime = Math.floor(Date.now() / 1000);
  const nbroMeasurements = 40;
  const keyRandomLevels = Array.from({ length: Math.ceil(nbroMeasurements / 6) + 1 })
    .map((_, i, arr) => Math.max(0, Math.min(
      config.sensorDistanceFromBottomMM,
      Math.floor(
        (arr[i - 1] as number) ??
        (config.sensorDistanceFromBottomMM / 2)
        + (Math.random() - 0.5) * config.sensorDistanceFromBottomMM / 3
      )
    )));
  // interpolate
  const randomLevels = Array.from({ length: nbroMeasurements })
    .map((_, i) => {
      const keyIndex = Math.floor(i / 6);
      const keyLevel = keyRandomLevels[keyIndex];
      const nextKeyLevel = keyRandomLevels[keyIndex + 1];
      const keyLevelFraction = (i % 6) / 6;
      return keyLevel + (nextKeyLevel - keyLevel) * keyLevelFraction;
    });
  const mockMeasurements = randomLevels
    .map((waterLevel, i) => ({
      time: currentTime - ((nbroMeasurements - i) * 60 * 60),
      waterLevel: waterLevel,
      batteryVoltage: (i / nbroMeasurements) * (4.2 - 3.6) + 3.6,
    })
    );
  const insertedTimes = mockMeasurements.map(measurement => measurement.time);
  await Promise.all(mockMeasurements.map(measurement => getDynamo().send(
    new PutCommand({
      TableName: getDataTableName(),
      Item: { ...measurement, hash: measurement.time },
    })
  )));
  insertedTimes.sort();
  return mockMeasurements
})

export { registrar }

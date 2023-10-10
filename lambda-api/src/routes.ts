import { APIGatewayProxyEventV2 } from "aws-lambda";
import { HttpBadRequestError, HttpNotFoundError, HttpUnauthorizedError, RouteHandlerRegistrar } from "./RouteHandlerRegistrar";
import { getDataTableName, getDynamo } from "./awsClients";
import { validateBatteryVoltage, validateDistance, validateTime } from "./validate";
import { publishMeasurement } from "./measurement";
import { CONFIG_KEYS_CONFIG, ConfigKey, parseUnitValue, updateConfigItem } from "./config";
import { PutCommand, ScanCommand } from "@aws-sdk/lib-dynamodb";
import { nowS } from "./time";


const BEARER_PREFIX = "Bearer ";
// If older than this, assume time of sensor is off and correct with server time 
const NEWEST_MEASUREMENT_MAX_AGE_S = 60 * 2;

enum HeaderTokenMatch {
  NotPresent,
  NoMatch,
  Match,
}

function headerTokenMatches(
  event: APIGatewayProxyEventV2,
  targetToken: string
) {
  const authorization = event.headers.authorization;
  if (!(typeof authorization === "string" && authorization.length > 0)) {
    return HeaderTokenMatch.NotPresent
  }
  if (!authorization.startsWith(BEARER_PREFIX)) {
    return HeaderTokenMatch.NoMatch
  }
  const eventToken = authorization.slice(BEARER_PREFIX.length);
  if (eventToken !== targetToken) {
    return HeaderTokenMatch.NoMatch
  }
  return HeaderTokenMatch.Match
}

function bearerTokenMatches(
  event: APIGatewayProxyEventV2,
  targetToken: string
) {
  const headerTokenMatch = headerTokenMatches(event, targetToken);
  if (headerTokenMatch !== HeaderTokenMatch.NotPresent) {
    return headerTokenMatch === HeaderTokenMatch.Match
  }
  const tokenFromQuery = event.queryStringParameters?.token;
  if (tokenFromQuery == null) {
    return false
  }
  return tokenFromQuery === targetToken
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
// .get("/postMeasurementFallback", async (event, getConfig) => {
//   const config = await getConfig();
//   const params = event.queryStringParameters ?? {};
//   if (params.token !== config.writeAuthorizationToken) {
//     throw new HttpUnauthorizedError()
//   }
//   const [distanceMM, distanceInvalid] = validateDistance(config, params.distanceMM)
//   if (distanceInvalid != null) {
//     throw new HttpBadRequestError(`distanceMM ${distanceInvalid}, got ${distanceMM}`)
//   }
//   const waterLevelMM = config.sensorDistanceFromBottomMM - distanceMM;
//   console.info(`Received distanceMM=${distanceMM}. sensorDistanceFromBottomMM=${config.sensorDistanceFromBottomMM} => waterLevelMM=${waterLevelMM}`)
//   const [batteryVoltage, batteryVoltageInvalid] = validateBatteryVoltage(params.batteryVoltage)
//   if (batteryVoltageInvalid != null) {
//     throw new HttpBadRequestError(`batteryVoltage ${batteryVoltageInvalid}, got ${batteryVoltage}`)
//   }
//   const time = nowS();
//   const measurement: Measurement = { hash: time, timeS: time, waterLevelMM, batteryVoltage }
//   await publishMeasurement(config, measurement);
//   return measurement;
// })
.post("/measurement", async (event, getConfig) => {
  const config = await getConfig();
  if (!bearerTokenMatches(event, config.writeAuthorizationToken)) {
    throw new HttpUnauthorizedError()
  }
  let clientData: Record<string, string | undefined> | Array<Record<string, string | number>> = event.queryStringParameters ?? {};
  const bodyBase64 = event.body;
  if (bodyBase64 != null && bodyBase64.trim().length > 0) {
    const bodyString = Buffer.from(bodyBase64, "base64").toString("utf-8");
    try { clientData = JSON.parse(bodyString) }
    catch (e) { if (e instanceof SyntaxError) {
      console.error(`Invalid JSON: ${e.message}. Got body (between ><): >${bodyString}<`)
      throw new HttpBadRequestError(`Invalid JSON: ${e.message}`)
    } else { throw e } }
  }
  function validateSensorMessage(message: any) {
    const [timeS, timeInvalid] = validateTime(message.timeS)
    if (timeInvalid != null) {
      throw new HttpBadRequestError(`time ${timeInvalid}, got ${message.timeS}`)
    }
    const [distanceMM, distanceInvalid] = validateDistance(config, message.distanceMM)
    if (distanceInvalid != null) {
      throw new HttpBadRequestError(`distanceMM ${distanceInvalid}, got ${message.distanceMM}`)
    }
    const waterLevelMM = config.sensorDistanceFromBottomMM - distanceMM;
    const [batteryVoltage, batteryVoltageInvalid] = validateBatteryVoltage(message.batteryVoltage)
    if (batteryVoltageInvalid != null) {
      throw new HttpBadRequestError(`batteryVoltage ${batteryVoltageInvalid}, got ${message.batteryVoltage}`)
    }
    return { timeS, waterLevelMM, batteryVoltage }
  }
  const messages = Array.isArray(clientData) ? clientData : [clientData];
  const validatedMessages = messages.map(validateSensorMessage);
  const newestMessage = validatedMessages[validatedMessages.length - 1];
  if (newestMessage == null) {
    throw new HttpBadRequestError("Empty array")
  }
  const now = nowS()
  if (newestMessage.timeS < now - NEWEST_MEASUREMENT_MAX_AGE_S) {
    console.log(`Newest message is too old: ${newestMessage.timeS} < now [${now}] - ${NEWEST_MEASUREMENT_MAX_AGE_S}. Correcting to server time...`)
    validatedMessages.forEach(message => message.timeS += now - newestMessage.timeS)
  }
  const measurements = validatedMessages.map(message => ({ hash: message.timeS, ...message }));
  await Promise.all(measurements.map(measurements => publishMeasurement(
    config, measurements
  )));
  const fieldDeployedReadableConfigValues = Object.fromEntries(
    Object.entries(CONFIG_KEYS_CONFIG)
      .filter(([_, { fieldDeployedReadable }]) => fieldDeployedReadable)
      .map(([key, { unit }]) => {
        const value = config[key as ConfigKey];
        return [key, { unit, value }]
      })
  )
  return { measurements, config: fieldDeployedReadableConfigValues, now }
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

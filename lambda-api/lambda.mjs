import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  ScanCommand,
  PutCommand,
} from "@aws-sdk/lib-dynamodb";
import { SNSClient, PublishCommand } from "@aws-sdk/client-sns";

const BEARER_PREFIX = "Bearer ";
const LAST_THRESHOLD_NOTIFICATION_KEY = "lastThresholdNotificationS";
const generateRandomToken = () => Array.from(
  Array(20),
  () => Math.floor(Math.random() * 36).toString(36)
).join('');
const c = (unit, defaultValue, userChangeable = true) => ({ unit, defaultValue, userChangeable })
const CONFIG_KEYS_CONFIG = {
  "sensorDistanceFromBottomMM": c("mm", 5000),
  "readAuthorizationToken": c("text", generateRandomToken),
  "writeAuthorizationToken": c("text", generateRandomToken),
  "lowerThresholdMM": c("mm", 0),
  "upperThresholdMM": c("mm", Number.MAX_SAFE_INTEGER),
  "thresholdMinimumNotificationIntervalS": c("s", 3 * 60 * 60),
  "fastDropAmountMM": c("mm", Number.MAX_SAFE_INTEGER),
  "fastDropTimeS": c("s", 0),
  "fastRiseAmountMM": c("mm", Number.MAX_SAFE_INTEGER),
  "fastRiseTimeS": c("s", 0),
  "lastThresholdNotificationS": c("s", 0, false),
}

function parseUnitValue(unit, value) {
  if (["mm", "s"].includes(unit)) {
    return Number(value);
  } else if (unit === "text") {
    return String(value);
  } else {
    throw new Error(`Unknown unit: ${unit}`);
  }
}

function nowS() {
  return Math.floor(Date.now() / 1000);
}

function envStringOrError(key) {
  const value = process.env[key];
  if (!(typeof value == "string" && value.length > 0)) {
    throw new Error(`Environment variable must be set and non-empty: ${key}`);
  }
  return value;
}

const dataTableName = envStringOrError("DYNAMODB_DATA_TABLE_NAME");
const configTableName = envStringOrError("DYNAMODB_CONFIG_TABLE_NAME");
const snsTopicArn = envStringOrError("SNS_TOPIC_ARN");
const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const sns = new SNSClient({});

function createResponse(statusCode, body) {
  return { statusCode, body, headers: { "content-type": "application/json" } };
}

function bearerTokenMatches(event, targetToken) {
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

async function updateConfigItem(config, key, value) {
  await dynamo.send(
    new PutCommand({
      TableName: configTableName,
      Item: { hash: key, key, value },
    })
  );
  config[key] = value;
}

async function createConfig() {
  const config = Object.fromEntries((await dynamo.send(
    new ScanCommand({ TableName: configTableName })
  )).Items.map(item => [item.key, item.value]));
  const updates = Object.entries(CONFIG_KEYS_CONFIG).map(([key, { defaultValue }]) => {
    if (config[key] == null) {
      const newValue = typeof defaultValue === "function" ? defaultValue() : defaultValue;
      return updateConfigItem(config, key, newValue);
    }
    return null;
  }).filter(x => x != null);
  await Promise.all(updates);
  return config;
}

async function snsPublish(message) {
  await sns.send(
    new PublishCommand({
      TopicArn: snsTopicArn,
      Message: message,
    })
  );
}

async function notifyNewMeasurement(config, waterLevel) {
  const {
    lowerThresholdMM, upperThresholdMM,
    thresholdMinimumNotificationIntervalS, lastThresholdNotificationS
  } = config;
  const now = nowS();
  if (waterLevel < lowerThresholdMM) {
    if (now - lastThresholdNotificationS > thresholdMinimumNotificationIntervalS) {
      await snsPublish(`Water level below threshold (${waterLevel} < ${lowerThresholdMM})`);
      updateConfigItem(config, LAST_THRESHOLD_NOTIFICATION_KEY, now);
    }
  }
  if (waterLevel > upperThresholdMM) {
    if (now - lastThresholdNotificationS > thresholdMinimumNotificationIntervalS) {
      await snsPublish(`Water level above threshold (${waterLevel} > ${upperThresholdMM})`);
      updateConfigItem(config, LAST_THRESHOLD_NOTIFICATION_KEY, now);
    }
  }
  const { fastDropAmountMM, fastDropTimeS, fastRiseAmountMM, fastRiseTimeS } = config;
  const startMeasurementTime = now - fastDropTimeS;
  const measurementsAroundStart = (await dynamo.send(
    new ScanCommand({
      TableName: dataTableName,
      Limit: 4,
      // FilterExpression: "time > :time",
      // ExpressionAttributeValues: {
      //   ":time": startMeasurementTime,
      // },
    })
  )).Items;
  console.log({ measurementsAroundStart });
  console.log({ fastDropAmountMM, fastDropTimeS, fastRiseAmountMM, fastRiseTimeS, startMeasurementTime, now });
}

function validateDistance(config, distanceMM) {
  const distanceMM = Number(distanceMM);
  if (!Number.isFinite(distanceMM)) {
    return [null, `not finite`]
  }
  if (!(distanceMM >= 0)) {
    return [null, `negative`]
  }
  if (!(distanceMM <= config.sensorDistanceFromBottomMM)) {
    return [null, `too large: > ${config.sensorDistanceFromBottomMM})`]
  }
  return [distanceMM, null]
}

function validateTime(time) {
  const time = Math.floor(time);
  if (!Number.isFinite(time)) {
    return [null, `not finite`]
  }
  if (time < 0) {
    return [ null, `negative` ];
  }
  const maxTime = nowS() + 1 * 60;
  if (time > maxTime) {
    return [null, `too large: > ${maxTime}` ]
  }
  return [time , null]
}

function validateBatteryVoltage(batteryVoltage) {
  if (["number", "string"].includes(typeof batteryVoltage)) {
    batteryVoltage = Number(batteryVoltage);
    if (!Number.isFinite(batteryVoltage)) {
      return [null, `not finite`]
    }
    if (batteryVoltage < 1) {
      return [null, `too small: < 1`]
    }
    if (batteryVoltage > 5) {
      return [null, `too large: > 5`]
    }
    return [batteryVoltage, null]
  }
  return [null, null]
}

async function publishMeasurement(config, measurement) {
  notifyNewMeasurement(config, measurement.waterLevel);
  return await dynamo.send(
    new PutCommand({
      TableName: dataTableName,
      Item: measurement,
    })
  );
}

export const handler = async (event) => {
  const httpContext = event.requestContext.http;
  const method = httpContext.method;
  const path = httpContext.path;
  const trailingSlashNormPath = path.endsWith("/") ? path.slice(0, -1) : path;
  let config = null;
  async function getConfig() {
    if (config == null) {
      config = await createConfig();
    }
    return config;
  }
  
  if (method === "GET" && trailingSlashNormPath === "/measurement") {
    const config = await getConfig();
    if (!bearerTokenMatches(event, config.readAuthorizationToken)) {
      return createResponse(401, { message: "Unauthorized" });
    }
    const res = await dynamo.send(
      new ScanCommand({ TableName: dataTableName })
    );
    return createResponse(200, res.Items);
  } else if (method === "GET" && trailingSlashNormPath === "/postMeasurementFallback") {
    const config = await getConfig();
    const params = event.requestContext.http.queryStringParameters;
    if (params.token !== config.writeAuthorizationToken) {
      return createResponse(401, { message: "Unauthorized" });
    }
    const [distanceInvalid, distanceMM] = validateDistance(config, params.distanceMM)
    if (distanceInvalid != null) {
      return createResponse(400, { message: `distanceMM ${distanceInvalid}, got ${distanceMM}` });
    }
    const waterLevel = config.sensorDistanceFromBottomMM - distanceMM;
    const [batteryVoltageInvalid, batteryVoltage] = validateBatteryVoltage(params.batteryVoltage)
    if (batteryVoltageInvalid != null) {
      return createResponse(400, { message: `batteryVoltage ${batteryVoltageInvalid}, got ${batteryVoltage}` });
    }
    notifyNewMeasurement(config, waterLevel)
    const time = nowS();
    const measurement = { hash: time, time, waterLevel, batteryVoltage }
    await publishMeasurement(config, measurement);
    return createResponse(200, measurement);
  } else if (method === "POST" && trailingSlashNormPath === "/measurement") {
    const config = await getConfig();
    if (!bearerTokenMatches(event, config.writeAuthorizationToken)) {
      return createResponse(401, { message: "Unauthorized" });
    }
    const body = JSON.parse(event.body);
    const [timeInvalid, time] = validateTime(body.time)
    if (timeInvalid != null) {
      return createResponse(400, { message: `time ${timeInvalid}, got ${body.time}` });
    }
    const [distanceInvalid, distanceMM] = validateDistance(config, body.distanceMM)
    if (distanceInvalid != null) {
      return createResponse(400, { message: `distanceMM ${distanceInvalid}, got ${body.distanceMM}` });
    }
    const waterLevel = config.sensorDistanceFromBottomMM - distanceMM;
    const [batteryVoltageInvalid, batteryVoltage] = validateBatteryVoltage(body.batteryVoltage)
    if (batteryVoltageInvalid != null) {
      return createResponse(400, { message: `batteryVoltage ${batteryVoltageInvalid}, got ${body.batteryVoltage}` });
    }
    const measurement = { hash: time, time, waterLevel, batteryVoltage }
    await publishMeasurement(config, measurement);
    return createResponse(200, measurement);
  } else if (method === "GET" && trailingSlashNormPath === "/config") {
    const config = await getConfig();
    if (!bearerTokenMatches(event, config.readAuthorizationToken)) {
      return createResponse(401, { message: "Unauthorized" });
    }
    const clientSideConfig = Object.fromEntries(
      Object.entries(CONFIG_KEYS_CONFIG)
      .filter(([_, { userChangeable }]) => userChangeable)
      .map(([key, { unit }]) => {
        const value = config[key];
        return [key, { unit, value }]
      })
    )
    return createResponse(200, clientSideConfig)
  } else if (method === "POST" && trailingSlashNormPath.startsWith("/config")) {
    const config = await getConfig();
    if (!bearerTokenMatches(event, config.readAuthorizationToken)) {
      return createResponse(401, { message: "Unauthorized" });
    }
    const configKey = trailingSlashNormPath.slice("/config/".length)
    const configKeyConfig = CONFIG_KEYS_CONFIG[configKey]
    if (configKeyConfig == null) {
      return createResponse(404, { message: `No such config key: ${configKey}` });
    }
    const { unit } = configKeyConfig;
    const body = JSON.parse(event.body);
    const value = parseUnitValue(unit, body.value)
    await updateConfigItem(config, configKey, value);
    return createResponse(200, { key: configKey, value });
  } else if (method === "GET" && trailingSlashNormPath === "/test") {
    await sns.send(
      new PublishCommand({
        TopicArn: snsTopicArn,
        Message: "Hello, world!",
      })
    );
    return createResponse(200, { message: "Hello, world!" });
  } else if (method === "POST" && trailingSlashNormPath === "/populate") {
    const config = await getConfig();
    if (!bearerTokenMatches(event, config.writeAuthorizationToken)) {
      return createResponse(401, { message: "Unauthorized" });
    }
    const currentTime = Math.floor(Date.now() / 1000);
    const nbroMeasurements = 40;
    const keyRandomLevels = Array.from({ length: Math.ceil(nbroMeasurements / 6) + 1 })
      .map((_, i, arr) => Math.max(0, Math.min(
        config.sensorDistanceFromBottomMM,
        Math.floor(
          arr[i - 1]?.waterLevel ??
          (config.sensorDistanceFromBottomMM / 2)
          + (Math.random() - 0.5) * config.sensorDistanceFromBottomMM / 3
        )
      ))
    );
    // interpolate
    const randomLevels = Array.from({ length: nbroMeasurements })
      .map((_, i, arr) => {
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
    await Promise.all(mockMeasurements.map(measurement => dynamo.send(
      new PutCommand({
        TableName: dataTableName,
        Item: { ...measurement, hash: measurement.time },
      })
    )));
    insertedTimes.sort();
    return createResponse(200, mockMeasurements);
  }

  return {
    statusCode: 404,
    body: "<!DOCTYPE html><html><body><h1>404 Not Found</h1><p>Try <a href='/'>/</a></p></body></html>",
    headers: {
      "content-type": "text/html",
    },
  };
};

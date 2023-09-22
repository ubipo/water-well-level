import { PublishCommand } from "@aws-sdk/client-sns";
import { getDataTableName, getDynamo, getSns } from "./awsClients";
import { Config, updateConfigItem } from "./config";
import { nowS } from "./time";
import { envStringOrThrow } from "./env";
import { PutCommand, ScanCommand } from "@aws-sdk/lib-dynamodb";


export interface Measurement {
  hash: number;
  timeS: number;
  waterLevelMM: number;
  batteryVoltage: number | null;
}

async function snsPublish(message: string) {
  await getSns().send(
    new PublishCommand({
      TopicArn: envStringOrThrow("SNS_TOPIC_ARN"),
      Message: message,
    })
  );
}

const LAST_THRESHOLD_NOTIFICATION_KEY = "lastThresholdNotificationS";

async function notifyNewMeasurement(config: Config, waterLevel: number) {
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
  const measurementsAroundStart = (await getDynamo().send(
    new ScanCommand({
      TableName: getDataTableName(),
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

export async function publishMeasurement(config: Config, measurement: Measurement) {
  notifyNewMeasurement(config, measurement.waterLevelMM);
  return await getDynamo().send(
    new PutCommand({
      TableName: getDataTableName(),
      Item: measurement,
    })
  );
}

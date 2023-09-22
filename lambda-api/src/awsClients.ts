import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { SNSClient } from "@aws-sdk/client-sns";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { envStringOrThrow } from "./env";


let dynamo: DynamoDBDocumentClient
let sns: SNSClient

export function getDynamo() {
  if (dynamo == null) {
    dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({}));
  }
  return dynamo
}

export function getSns() {
  if (sns == null) {
    sns = new SNSClient({});
  }
  return sns
}

export function getDataTableName() {
  return envStringOrThrow("DYNAMODB_DATA_TABLE_NAME")
}

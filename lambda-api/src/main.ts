import { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { Config, createConfig } from "./config";
import { registrar } from "./routes";


export const handler: APIGatewayProxyHandlerV2 = async event => {
  let config: Config
  async function getConfig() {
    if (config == null) {
      config = await createConfig()
    }
    return config;
  }

  return await registrar.handleEvent(event, getConfig)
};

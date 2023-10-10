import { APIGatewayProxyEventV2 } from "aws-lambda"
import { Config } from "./config"
import { NotFoundException } from "@aws-sdk/client-sns"


type RoutePathSpecifier = string | ((event: APIGatewayProxyEventV2) => boolean)
type Handler = (event: APIGatewayProxyEventV2, getConfig: () => Promise<Config>) => Promise<any>

abstract class HttpError extends Error {
  name = HttpError.constructor.name
  statusCode: number = 500
}

export class HttpUnauthorizedError extends HttpError {
  name = HttpUnauthorizedError.constructor.name
  statusCode = 401

  constructor(message?: string) {
    super(`Unauthorized: ${message ?? ""}`)
  }
}

export class HttpBadRequestError extends HttpError {
  name = HttpBadRequestError.constructor.name
  statusCode = 400

  constructor(message?: string) {
    super(`Bad Request: ${message ?? ""}`)
  }
}

export class HttpNotFoundError extends HttpError {
  name = HttpNotFoundError.constructor.name
  message = "Not Found"
  statusCode = 404

  constructor(message?: string) {
    super(`Not Found: ${message ?? ""}`)
  }
}

interface Route {
  method: string
  path: RoutePathSpecifier
  handler: Handler
}

const NOT_FOUND_RESPONSE = {
  statusCode: 404,
  body: "<!DOCTYPE html><html><body><h1>404 Not Found</h1><p>Try <a href='/'>/</a></p></body></html>",
  headers: {
    "content-type": "text/html",
  },
}

export class RouteHandlerRegistrar {
  #routes: Route[] = []
  get(path: RoutePathSpecifier, handler: Handler) {
    this.#routes.push({ method: "GET", path, handler })
    return this
  }
  post(path: RoutePathSpecifier, handler: Handler) {
    this.#routes.push({ method: "POST", path, handler })
    return this
  }
  async handleEvent(event: APIGatewayProxyEventV2, getConfig: () => Promise<Config>) {
    const httpContext = event.requestContext.http
    const method = httpContext.method
    const path = httpContext.path
    const trailingSlashNormPath = path.endsWith("/") ? path.slice(0, -1) : path
    const route = this.#routes.find(route => {
      if (route.method !== method) return false
      if (typeof route.path === "function") return route.path(event)
      return route.path === trailingSlashNormPath
    })
    if (route == null) return NOT_FOUND_RESPONSE
    let response
    try {
      response = await route.handler(event, getConfig)
    } catch (error) {
      if (error instanceof NotFoundException) {
        return NOT_FOUND_RESPONSE
      } else if (error instanceof HttpError) {
        console.error(`Sending ${error.statusCode} for ${method} ${path}: ${error.message}`)
        return {
          statusCode: error.statusCode,
          body: JSON.stringify({ message: error.message }),
          headers: { "content-type": "application/json" }
        }
      } else {
        console.error(`Error handling ${method} ${path}:`)
        console.error((error as Error).stack)
        return {
          statusCode: 500,
          body: JSON.stringify({
            stack: (error as Error).stack,
            message: (error as Error).message,
          }),
          headers: { "content-type": "application/json" }
        }
      }
    }
    let statusCode, responseBody
    if (response == null) {
      statusCode = 204
      responseBody = undefined
    } else if (typeof response === "string") {
      statusCode = 200
      responseBody = response
    } else if (typeof response === "object") {
      statusCode = 200
      responseBody = JSON.stringify(response)
    } else {
      throw new Error(`Invalid response: ${response}`)
    }
    return {
      statusCode,
      body: responseBody,
      headers: { "content-type": "application/json" }
    };
  }
}

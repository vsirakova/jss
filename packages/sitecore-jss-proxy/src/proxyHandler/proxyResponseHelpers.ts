import { IncomingMessage, ServerResponse } from 'http';
import proxy from 'http-proxy-middleware';
import webOutgoing from 'http-proxy/lib/http-proxy/passes/web-outgoing';
import setCookieParser from 'set-cookie-parser';
import { AppRenderer } from '../AppRenderer';
import { Logger } from '../Logger';
import { ParsedRequest } from '../ParsedRequest';
import { ProxyConfig } from '../ProxyConfig';

// Get all functions exported by the `web-outgoing` module.
const httpProxyWebOutgoingMethods = Object.values(webOutgoing);

export function doCommonShit(
  proxyResponse: IncomingMessage,
  request: ParsedRequest,
  serverResponse: ServerResponse,
  config: ProxyConfig
) {
  removeEmptyAnalyticsCookie(proxyResponse);
  defaultResponseModifier(request, serverResponse, proxyResponse, config.proxyOptions || {});
}

// Normally, the proxy module handles a few actions by itself during the response,
// e.g. setting the 'connection' header, rewrite cookie domain/path, copying headers.
// However, when the `selfHandleResponse` option is true, the proxy module does not
// perform those "default" actions.
// The workaround is to directly import the "private" methods from the proxy module
// and manually invoke them ourselves while handling the proxy response.
// related code and issue:
// https://github.com/nodejitsu/node-http-proxy/blob/a3fe02d651d05d02d0ced377c22ae8345a2435a4/lib/http-proxy/passes/web-incoming.js#L170
// https://github.com/nodejitsu/node-http-proxy/blob/master/lib/http-proxy/passes/web-outgoing.js
// https://github.com/nodejitsu/node-http-proxy/issues/1263
export function defaultResponseModifier(
  request: ParsedRequest,
  serverResponse: ServerResponse,
  proxyResponse: IncomingMessage,
  proxyOptions: proxy.Config,
  webOutgoingMethods: any[] = httpProxyWebOutgoingMethods
) {
  if (!serverResponse.headersSent) {
    // It is expected that the webOutgoingMethods largely share the same
    // signature, so instead of calling each method by name, we can
    // iterate the array of methods and invoke them "generically".
    webOutgoingMethods.forEach((method) => {
      method(request, serverResponse, proxyResponse, proxyOptions);
    });
  }
}

export function convertResponseToReadonlyResponse<T>(
  response: any,
  onBeforeFreeze?: (convertedResponse: any) => void
) {
  const readonlyResponse = Object.keys(response).reduce((result: any, key: string) => {
    if (typeof response[key] !== 'function') {
      result[key] = response[key];
    }
    return result;
  }, {});

  if (onBeforeFreeze) {
    onBeforeFreeze(readonlyResponse);
  }

  return Object.freeze(readonlyResponse as T);
}

// These actions are common to _all_ responses, both pipeable and non-pipeable
export function finalizeServerResponse(
  serverResponse: ServerResponse,
  readonlyProxyResponse: ReadonlyProxyResponse,
  request: ParsedRequest,
  config: ProxyConfig,
  logger: Logger
) {
  // remove IIS server header for security
  serverResponse.removeHeader('server');

  // If a custom `setHeaders` function is specified, call it when we're good and ready for it to be called.
  // Technically, this could be used to modify any property in the serverResponse prior to
  // the response being sent.
  // Perhaps we should change the function name?
  // Also, we probably don't need to pass the proxy response. Unless devs would possibly want to compare
  // the proxy response to the server response?
  if (config.setHeaders) {
    config.setHeaders(request, serverResponse, readonlyProxyResponse);
  }

  // prettier-ignore
  logger.log('DEBUG', 'FINAL response headers for client', JSON.stringify(serverResponse.getHeaders(), null, 2));
  logger.log('DEBUG', 'FINAL status code for client', serverResponse.statusCode);
}

// For some reason, every other response returned by Sitecore contains the 'set-cookie'
// header with the SC_ANALYTICS_GLOBAL_COOKIE value as an empty string.
// This effectively sets the cookie to empty on the client as well, so if a user were to close their browser
// after one of these 'empty value' responses, they would not be tracked as a returning visitor after re-opening their browser.
// To address this, we simply parse the response cookies and if the analytics cookie is present but has an empty value, then we
// remove it from the response header. This means the existing cookie in the browser remains intact.
export const removeEmptyAnalyticsCookie = (proxyResponse: any) => {
  const cookies = setCookieParser.parse(proxyResponse.headers['set-cookie']);
  if (cookies) {
    const analyticsCookieIndex = cookies.findIndex(
      (c: any) => c.name === 'SC_ANALYTICS_GLOBAL_COOKIE'
    );
    if (analyticsCookieIndex !== -1) {
      const analyticsCookie = cookies[analyticsCookieIndex];
      if (analyticsCookie && analyticsCookie.value === '') {
        cookies.splice(analyticsCookieIndex, 1);
        proxyResponse.headers['set-cookie'] = cookies;
      }
    }
  }
};

// types

export type ProxyResponseHandler = (
  handlerArgs: ProxyResponseHandlerArgs,
  ...otherArgs: any[]
) => void;

export type ProxyResponseHandlerFactory = (
  proxyResponse: IncomingMessage,
  request: ParsedRequest,
  config: ProxyConfig,
  logger: Logger
) => ProxyResponseHandler;

export interface ProxyResponseHandlerArgs {
  proxyResponse: IncomingMessage;
  serverResponse: ServerResponse;
  request: ParsedRequest;
  config: ProxyConfig;
  logger: Logger;
  appRenderer: AppRenderer;
}

export interface ResponseInfo {
  content: string;
  statusCode: number;
  headers?: any;
}

// thank you TypeScript docs! https://www.typescriptlang.org/docs/handbook/advanced-types.html
export type NonFunctionPropertyNames<T> = {
  // tslint:disable-next-line ban-types
  [K in keyof T]: T[K] extends Function ? never : K
}[keyof T];
export type NonFunctionProperties<T> = Pick<T, NonFunctionPropertyNames<T>>;

/**
 * Provides all of the properties - that are not functions - from the IncomingMessage interface.
 */
export interface ReadonlyProxyResponse extends Readonly<NonFunctionProperties<IncomingMessage>> {}

/**
 * Provides all of the properties - that are not functions - from the ServerResponse interface.
 * Along with an additional `.headers` property containing the response heades.
 */
export interface ReadonlyServerResponse extends Readonly<NonFunctionProperties<ServerResponse>> {
  headers: {
    [key: string]: any;
  };
}

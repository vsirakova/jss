import { ServerResponse } from 'http';
import { AppRenderer } from '../AppRenderer';
import { Logger } from '../Logger';
import { ParsedRequest } from '../ParsedRequest';
import { ProxyConfig } from '../ProxyConfig';
import { extractJsonFromResponseData } from './jsonDataExtractor';
import {
  convertResponseToReadonlyResponse,
  doCommonShit,
  finalizeServerResponse,
  ProxyResponseHandlerArgs,
  ReadonlyProxyResponse,
  ReadonlyServerResponse,
  ResponseInfo,
} from './proxyResponseHelpers';

export type GetResponseInfo = (responseInfoArgs: GetResponseInfoArgs) => Promise<ResponseInfo>;

export interface GetResponseInfoArgs {
  layoutServiceData: any;
  readonlyProxyResponse: ReadonlyProxyResponse;
  readonlyServerResponse: ReadonlyServerResponse;
  request: ParsedRequest;
  config: ProxyConfig;
  logger: Logger;
  appRenderer: AppRenderer;
}

export function withCommonShit(handlerArgs: ProxyResponseHandlerArgs) {
  const { proxyResponse, request, serverResponse, config } = handlerArgs;
  doCommonShit(proxyResponse, request, serverResponse, config);
  return (getResponseInfo: GetResponseInfo) => {
    handleProxyResponseEvents(handlerArgs, getResponseInfo);
  };
}

export function handleProxyResponseEvents(
  { config, logger, proxyResponse, request, serverResponse, appRenderer }: ProxyResponseHandlerArgs,
  getResponseInfo: GetResponseInfo
) {
  const readonlyProxyResponse = convertResponseToReadonlyResponse<ReadonlyProxyResponse>(
    proxyResponse
  );
  const readonlyServerResponse = getReadonlyServerResponse(serverResponse);

  // Buffer the response body as it is written so that we can do something with it when the response ends.
  const responseDataWriter = { output: Buffer.from('') };
  proxyResponse.on('data', readResponseBody(responseDataWriter, config));

  // As the proxy response is ending, determine how to handle the server response content, e.g. transform it or use it for rendering.
  proxyResponse.on('end', () => {
    const contentEncoding = proxyResponse.headers['content-encoding'];
    // prettier-ignore
    // extract the "raw" (albeit decoded) JSON data from the response
    extractJsonFromResponseData(responseDataWriter.output, logger, contentEncoding)
      .then((extractedLayoutServiceData) => {
        if (!extractedLayoutServiceData) {
          // prettier-ignore
          // tslint:disable-next-line max-line-length
          throw new Error(`Could not extract Layout Service data from proxy response. Proxy response status: (code: ${proxyResponse.statusCode}): ${proxyResponse.statusMessage}`);
        }
        return extractedLayoutServiceData;
      })
      .then((layoutServiceData) => {
        // If a custom layout service transform function has been defined, we want the function
        // to fulfill its glorious destiny for both proxied layout service requests and
        // for requests that will be SSR'd.
        return config.transformLayoutServiceData ?
          config.transformLayoutServiceData(layoutServiceData, request, readonlyProxyResponse) :
          layoutServiceData;
      })
      .then((layoutServiceData) =>
        getResponseInfo({ layoutServiceData, readonlyProxyResponse, readonlyServerResponse, request, config, logger, appRenderer }))
      .then((responseInfo) => {
        prepareModifiedContentResponse(responseInfo.content, serverResponse, responseInfo.headers);
        finalizeServerResponse(serverResponse, readonlyProxyResponse, request, config, logger);
        return responseInfo;
      })
      .catch((err) => {
        // Is a 500 error code appropriate here?
        // Basically, we're catching any errors that might occur in the previous `then()`,
        // where we're changing the server response.
        return { content: err, statusCode: 500 } as ResponseInfo;
      })
      .then((info) => {
        serverResponse.statusCode = info.statusCode;
        serverResponse.end(info.content, 'utf-8');
      })
      .catch((err: Error) => {
        throw err;
      });
  });
}

// function replies with HTTP 500 when an error occurs
export async function getErrorResponseInfo(
  error: Error,
  readonlyProxyResponse: ReadonlyProxyResponse,
  config: ProxyConfig,
  logger: Logger
) {
  logger.log('error', error);

  let errorResponse = {
    statusCode: readonlyProxyResponse.statusCode || 500,
    content: readonlyProxyResponse.statusMessage || 'Internal Server Error',
  };

  if (config.onError) {
    const onError = await config.onError(error, readonlyProxyResponse, logger);
    errorResponse = { ...errorResponse, ...onError };
  }

  return errorResponse;
}

// These actions are common to only non-pipeable responses
export function prepareModifiedContentResponse(
  content: Buffer | string,
  serverResponse: ServerResponse,
  headers?: any
) {
  if (headers) {
    Object.keys(headers).forEach((headerKey) => {
      serverResponse.setHeader(headerKey, headers[headerKey]);
    });
  }

  // We need the  *byte count* (rather than character count) of the body
  const contentLength =
    typeof content === 'string' ? Buffer.byteLength(content) : content.byteLength;

  // setting the content-length header is not absolutely necessary, but is recommended
  serverResponse.setHeader('content-length', contentLength);

  // If the response data is gzip or deflate, assume we've decompressed it for processing/manipulation
  // and therefore need to remove the `content-encoding` header from the outgoing response because
  // the outgoing response will not be encoded (at least not by this proxy middleware).
  // Note: because of the `defaultResponseModifier` method, all the proxy response headers have been
  // copied to the server response by this point.
  // prettier-ignore
  const contentEncoding = serverResponse.getHeader('content-encoding');
  if (
    contentEncoding &&
    typeof contentEncoding === 'string' &&
    (contentEncoding.indexOf('gzip') !== -1 || contentEncoding.indexOf('deflate') !== -1)
  ) {
    serverResponse.removeHeader('content-encoding');
  }
}

export function readResponseBody(responseDataWriter: { output: Buffer }, config: ProxyConfig) {
  return (data: any) => {
    if (Buffer.isBuffer(data)) {
      responseDataWriter.output = Buffer.concat([responseDataWriter.output, data]); // append raw buffer
    } else {
      // ReadableStream.on('data') does not pass in `encoding` as an argument
      // to the data handler callback. So if the data chunk is a string, we don't know
      // the encoding. Probably not that big of a deal if we can _assume_ UTF-8 encoding,
      // but is that a fair assumption?
      responseDataWriter.output = Buffer.concat([responseDataWriter.output, Buffer.from(data)]);
    }

    // sanity check: if the response is huge, bail.
    // ...we don't want to let someone bring down the server by filling up all our RAM.
    if (responseDataWriter.output.length > (config.maxResponseSizeBytes as number)) {
      // prettier-ignore
      throw new Error('Response data from proxy target exceeded the `maxResponseSizeBytes` configuration setting.');
    }
  };
}

export function getReadonlyServerResponse(serverResponse: ServerResponse) {
  const readonlyResponse = convertResponseToReadonlyResponse<ReadonlyServerResponse>(
    serverResponse,
    (convertedResponse) => {
      convertedResponse.headers = {
        ...serverResponse.getHeaders(),
      };
    }
  );

  return readonlyResponse;
}

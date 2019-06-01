import {
  convertResponseToReadonlyResponse,
  finalizeServerResponse,
  ProxyResponseHandler,
  ProxyResponseHandlerArgs,
  ReadonlyProxyResponse,
} from './proxyResponseHelpers';

export const defaultPipeableResponseHandler: ProxyResponseHandler = ({
  serverResponse,
  proxyResponse,
  logger,
  config,
  request,
}: ProxyResponseHandlerArgs) => {
  const readonlyProxyResponse = convertResponseToReadonlyResponse<ReadonlyProxyResponse>(
    proxyResponse
  );

  // A few notes:
  // * `defaultResponseModifier` copies headers from `proxyResponse` to `serverResponse`.
  // * `proxyResponse.pipe` does _not_ pipe headers from `proxyResponse` to `serverResponse`, it only pipes the response body.
  //    So header changes can be made to serverResponse without being overwritten.
  // give us a chance to do things before the response is written and ended.
  finalizeServerResponse(serverResponse, readonlyProxyResponse, request, config, logger);
  // When http-proxy `selfHandleResponse` is true, we need to pipe the proxy response to the server response.
  proxyResponse.pipe(serverResponse);
  // note: you do not need to call serverResponse.end() here.
};

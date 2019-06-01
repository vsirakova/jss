// add config options for:
// pipeableHandler
// layoutServiceHandler
// handlerFactory
import { IncomingMessage } from 'http';
import { Logger } from '../Logger';
import { ParsedRequest } from '../ParsedRequest';
import { ProxyConfig } from '../ProxyConfig';
import { defaultLayoutServiceResponseHandler } from './defaultLayoutServiceResponseHandler';
import { defaultPipeableResponseHandler } from './defaultPipeableResponseHandler';
import { urlShouldNotBeRewritten } from './defaultProxyRequestPathRewriter';
import { defaultSSRResponseHandler } from './defaultSSRResponseHandler';
import { ProxyResponseHandlerFactory } from './proxyResponseHelpers';

export const defaultProxyResponseHandlerFactory: ProxyResponseHandlerFactory = (
  proxyResponse: IncomingMessage,
  request: ParsedRequest,
  config: ProxyConfig,
  logger: Logger
) => {
  logger.log('DEBUG', 'request url', request.url);
  logger.log('DEBUG', 'request query', JSON.stringify(request.parsedUrl.query, null, 2));
  logger.log('DEBUG', 'proxied request response code', proxyResponse.statusCode);
  logger.log('DEBUG', 'RAW request headers', JSON.stringify(request.headers, null, 2));
  // prettier-ignore
  logger.log('DEBUG', 'RAW headers from the proxied response', JSON.stringify(proxyResponse.headers, null, 2));

  // TODO: figure out how to handle 301 status code...
  // also need to support `followRedirect` proxy config property.
  const statusCode = proxyResponse.statusCode;
  if (statusCode && (statusCode === 200 || statusCode === 404)) {
    // normally would set extractedlayoutservice data to null in this scenario...
    // likely need to move this condition somewhere earlier, e.g.
    // before we look for transformable LS.
    // also need to account for 301, if 301 then we should probably
    // just pipe the response?
    // return defaultRedirectResponseHandler;
  }

  // If the request URL contains any of the excluded rewrite routes and
  // the request is not a layout service request whose response data can be transformed,
  // we assume the response does not need to be server rendered or transformed.
  // Instead, the response should just be piped. Though we can still modify the serverResponse before it is sent.
  if (isPipeableResponse(request.url, config)) {
    return config.pipeableResponseHandler || defaultPipeableResponseHandler;
  }

  // If the request URL contains the layout service endpoint path and
  // a custom layout service transform function has been defined,
  // then complete the response using the transformed layout service data.
  if (isTransformableLayoutServiceRequest(request.url, config)) {
    return config.layoutServiceResponseHandler || defaultLayoutServiceResponseHandler;
  }

  // Else we can assume the request to the proxy was a layout service request,
  // and the response should be the server-rendered app.
  // You may be asking: why do we need to render the app here? why not just pass the JSON response
  // to another piece of middleware that will render the app?
  // Answer: the `http-proxy-middleware` ends the response and does not "chain", i.e. call `next()`
  return config.ssrResponseHandler || defaultSSRResponseHandler;
};

export function isPipeableResponse(requestUrl: string = '', config: ProxyConfig) {
  return (
    urlShouldNotBeRewritten(requestUrl, config) &&
    !isTransformableLayoutServiceRequest(requestUrl, config)
  );
}

export function isTransformableLayoutServiceRequest(url: string = '', config: ProxyConfig) {
  // if the provided URL contains the defined layout service route and a transform
  // function is provided, then the response data is eligible for transformation.
  return (
    url.toLowerCase().indexOf(config.layoutServiceRoute.toLowerCase()) !== -1 &&
    typeof config.transformLayoutServiceData === 'function'
  );
}

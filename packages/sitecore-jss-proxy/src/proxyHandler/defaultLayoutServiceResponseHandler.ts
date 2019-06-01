import {
  getErrorResponseInfo,
  GetResponseInfoArgs,
  withCommonShit,
} from './modifiedResponseHelpers';
import { ProxyResponseHandler, ResponseInfo } from './proxyResponseHelpers';

export const defaultLayoutServiceResponseHandler: ProxyResponseHandler = (handlerArgs) => {
  withCommonShit(handlerArgs)(getResponseInfo);
};

export async function getResponseInfo({
  layoutServiceData,
  readonlyProxyResponse,
  request,
  config,
  logger,
}: GetResponseInfoArgs): Promise<ResponseInfo> {
  try {
    // If the request URL contains the layout service endpoint path and
    // a custom layout service transform function has been defined,
    // then complete the response using the transformed layout service data.

    // prettier-ignore
    logger.log('DEBUG', `layout service request was transformed, returning transformed data for URL '${request.url}'`);

    const finalStatusCode = readonlyProxyResponse.statusCode || 200;

    // layoutServiceData _should_ be an object, and if defined we need to stringify it
    // before passing it along.
    // There may be an opportunity for more type-checking here to make it more "robust"
    // for careless devs, but...
    return {
      content: layoutServiceData ? JSON.stringify(layoutServiceData) : '',
      statusCode: finalStatusCode,
    };
  } catch (error) {
    const errorResponse = await getErrorResponseInfo(error, readonlyProxyResponse, config, logger);
    return errorResponse;
  }
}

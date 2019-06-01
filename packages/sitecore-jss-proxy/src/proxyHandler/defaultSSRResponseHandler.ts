import {
  getErrorResponseInfo,
  GetResponseInfoArgs,
  withCommonShit,
} from './modifiedResponseHelpers';
import { ProxyResponseHandler, ResponseInfo } from './proxyResponseHelpers';
import { renderApp } from './renderApp';

export const defaultSSRResponseHandler: ProxyResponseHandler = (handlerArgs) => {
  withCommonShit(handlerArgs)(getResponseInfo);
};

export async function getResponseInfo({
  layoutServiceData,
  readonlyProxyResponse,
  readonlyServerResponse,
  request,
  config,
  logger,
  appRenderer,
}: GetResponseInfoArgs): Promise<ResponseInfo> {
  try {
    // prettier-ignore
    const renderAppResult = await renderApp(layoutServiceData, readonlyProxyResponse, request, readonlyServerResponse, appRenderer, config);

    let html = renderAppResult.renderingResult.html;

    // Provide developers with an opportunity to transform the rendered app
    // html before we complete the response.
    if (config.transformSSRContent) {
      // prettier-ignore
      html = await config.transformSSRContent(renderAppResult.renderingResult, request, readonlyServerResponse);
    }

    // In summary, we parsed the proxy response body which is JSON, then
    // rendered the app using that JSON, and now return HTML to the final response.
    return {
      content: html,
      statusCode: renderAppResult.statusCode,
      headers: renderAppResult.headers,
    };
  } catch (error) {
    const errorResponse = await getErrorResponseInfo(error, readonlyProxyResponse, config, logger);
    return errorResponse;
  }
}

import { AppRenderer } from '../AppRenderer';
import { ParsedRequest } from '../ParsedRequest';
import { ProxyConfig } from '../ProxyConfig';
import { RenderResponse } from '../RenderResponse';
import { ReadonlyProxyResponse, ReadonlyServerResponse } from './proxyResponseHelpers';

export async function renderApp(
  layoutServiceData: any,
  proxyResponse: ReadonlyProxyResponse,
  request: ParsedRequest,
  serverResponse: ReadonlyServerResponse,
  renderer: AppRenderer,
  config: ProxyConfig
): Promise<{ renderingResult: RenderResponse; statusCode: number; headers: any }> {
  if (config.debug) {
    console.log('DEBUG: rendering app');
  }

  const viewBag = await createViewBag();

  return new Promise<{ renderingResult: RenderResponse; statusCode: number; headers: any }>(
    (resolve, reject) => {
      // invoke the app renderer, which _should_ invoke the `handleRenderingResult` callback
      // when the app is done rendering.
      renderer(handleRenderingResult, request.url || '', layoutServiceData, viewBag);

      function handleRenderingResult(error: Error | null, renderingResult: RenderResponse | null) {
        const renderError = determineRenderingError(error, renderingResult);
        if (renderError) {
          reject(renderError);
        }

        // make TS happy since it is unable to infer from `getError` that `result` must be defined at this point.
        const result = renderingResult as RenderResponse;

        const headers: any = {
          'content-type': 'text/html; charset=utf-8',
        };

        if (result.redirect) {
          if (!result.status) {
            result.status = 302;
          }

          headers['location'] = result.redirect;
        }

        const finalStatusCode = result.status || proxyResponse.statusCode || 200;

        resolve({
          renderingResult: result,
          statusCode: finalStatusCode,
          headers,
        });
      }
    }
  );

  function determineRenderingError(error: Error | null, result: RenderResponse | null) {
    if (!error && !result) {
      return new Error('Render function did not return a result or an error!');
    }

    if (error) {
      return error;
    }

    if (!result) {
      // should not occur, but makes TS happy
      return new Error('Render function result did not return a result.');
    }

    if (!result.html) {
      return new Error('Render function result was returned but html property was falsy.');
    }

    return null;
  }

  async function createViewBag(): Promise<any> {
    const defaultViewBag = { statusCode: proxyResponse.statusCode, dictionary: {} };

    if (!config.createViewBag) {
      return defaultViewBag;
    }

    const customViewBag = await config.createViewBag(
      request,
      serverResponse,
      proxyResponse,
      layoutServiceData
    );

    return { ...defaultViewBag, ...customViewBag };
  }
}

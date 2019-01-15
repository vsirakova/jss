import { EventEmitter } from 'events';
import { ClientRequest, IncomingMessage, ServerResponse } from 'http';
import proxy from 'http-proxy-middleware';
import httpProxyWebOutgoing from 'http-proxy/lib/http-proxy/passes/web-outgoing';
import setCookieParser from 'set-cookie-parser';
import zlib from 'zlib'; // node.js standard lib
import { AppRenderer } from './AppRenderer';
import { ProxyConfig } from './ProxyConfig';
import { RenderResponse } from './RenderResponse';
import { RouteUrlParser } from './RouteUrlParser';
import { buildQueryString, tryParseJson } from './util';

// Get all functions exported by the `web-outgoing` module.
// The methods largely share the same signature, so instead of calling
// each method by name, we can iterate the array of methods and invoke them "generically".
const webOutgoingMethods = Object.values(httpProxyWebOutgoing);

// tslint:disable:max-line-length

// For some reason, every other response returned by Sitecore contains the 'set-cookie' header with the SC_ANALYTICS_GLOBAL_COOKIE value as an empty string.
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
        /* eslint-disable no-param-reassign */
        proxyResponse.headers['set-cookie'] = cookies;
        /* eslint-enable no-param-reassign */
      }
    }
  }
};

// function replies with HTTP 500 when an error occurs
async function replyWithError(
  error: Error,
  proxyResponse: IncomingMessage,
  config: ProxyConfig,
  serverResponse: ServerResponse,
  emitter: EventEmitter
) {
  console.error(error);

  let errorResponse = {
    statusCode: proxyResponse.statusCode || 500,
    content: proxyResponse.statusMessage || 'Internal Server Error',
  };

  if (config.onError) {
    const onError = await config.onError(error, proxyResponse);
    errorResponse = { ...errorResponse, ...onError };
  }

  completeResponse(
    Buffer.from(errorResponse.content),
    errorResponse.statusCode,
    serverResponse,
    emitter
  );
}

function completeResponse(
  content: Buffer | string,
  statusCode: number,
  serverResponse: ServerResponse,
  emitter: EventEmitter,
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

  serverResponse.statusCode = statusCode;

  // give us a chance to do things before the response is written and ended.
  // note: emit is synchronous and calls listeners synchronously, so any listeners
  // that are async or perform async operations won't complete before the next tick.
  emitter.emit('before-response-write');

  serverResponse.write(content);

  serverResponse.end();
}

async function extractJsonFromResponseData(
  responseData: Buffer,
  config: ProxyConfig,
  statusCode: number | undefined,
  contentEncoding: string | undefined
): Promise<object | null> {
  if (statusCode && (statusCode === 200 || statusCode === 404)) {
    let responseString: Promise<string>;

    if (
      contentEncoding &&
      (contentEncoding.indexOf('gzip') !== -1 || contentEncoding.indexOf('deflate') !== -1)
    ) {
      responseString = new Promise((resolve, reject) => {
        if (config.debug) {
          console.log('Layout service response is compressed; decompressing.');
        }

        zlib.unzip(responseData, (error, result) => {
          if (error) {
            reject(error);
          }

          if (result) {
            resolve(result.toString('utf-8'));
          }
        });
      });
    } else {
      responseString = Promise.resolve(responseData.toString('utf-8'));
    }

    return responseString.then(tryParseJson);
  }

  return Promise.resolve(null);
}

async function renderApp(
  layoutServiceData: any,
  proxyResponse: IncomingMessage,
  request: ClientRequest,
  serverResponse: ServerResponse,
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
      renderer(handleRenderingResult, (request as any).originalUrl, layoutServiceData, viewBag);

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

function isTransformableLayoutServiceRequest(url: string, config: ProxyConfig) {
  return (
    url.toLowerCase().indexOf(config.layoutServiceRoute.toLowerCase()) !== -1 &&
    config.transformLayoutServiceData
  );
}

function defaultResponseModifier(
  proxyResponse: IncomingMessage,
  request: any,
  serverResponse: ServerResponse,
  proxyOptions: proxy.Config
) {
  if (!serverResponse.headersSent) {
    webOutgoingMethods.forEach((method) => {
      method(request, serverResponse as any, proxyResponse, proxyOptions as any);
    });
  }
}

// Handles the response from the "origin" server, i.e. Sitecore CD server
// At this point, we're allowed to configure and modify the outgoing response from the Node server.
function handleProxyResponse(
  proxyResponse: IncomingMessage,
  request: any,
  serverResponse: ServerResponse,
  renderer: AppRenderer,
  config: ProxyConfig,
  proxyOptions: proxy.Config
) {
  if (config.debug) {
    console.log('DEBUG: request url', request.url);
    console.log('DEBUG: request query', request.query);
    console.log('DEBUG: request original url', request.originalUrl);
    console.log('DEBUG: proxied request response code', proxyResponse.statusCode);
    console.log('DEBUG: RAW request headers', JSON.stringify(request.headers, null, 2));
    console.log(
      'DEBUG: RAW headers from the proxied response',
      JSON.stringify(proxyResponse.headers, null, 2)
    );
  }

  const emitter = new EventEmitter();

  removeEmptyAnalyticsCookie(proxyResponse);

  // Normally, the proxy module handles a few actions by itself during the response,
  // e.g. setting the 'connection' header, rewrite cookie domain/path
  // However, when the `selfHandleResponse` option is true, the proxy module does not
  // perform those "default" actions.
  // The workaround is to directly import the "private" methods from the proxy module
  // and manually invoke them ourselves while handling the proxy response.
  // related code and issue:
  // https://github.com/nodejitsu/node-http-proxy/blob/a3fe02d651d05d02d0ced377c22ae8345a2435a4/lib/http-proxy/passes/web-incoming.js#L170
  // https://github.com/nodejitsu/node-http-proxy/blob/master/lib/http-proxy/passes/web-outgoing.js
  // https://github.com/nodejitsu/node-http-proxy/issues/1263
  defaultResponseModifier(proxyResponse, request, serverResponse, proxyOptions);

  // Listen for the `before-response-write` event, which allows us to invoke developer-provided hooks
  // without having to pass the `request` object through multiple levels
  emitter.on('before-response-write', () => {
    // remove IIS server header for security
    serverResponse.removeHeader('server');

    // If a custom `setHeaders` function is specified, call it when we're good and ready for it to be called.
    if (config.setHeaders) {
      config.setHeaders(request, serverResponse, proxyResponse);
    }

    if (config.debug) {
      console.log(
        'DEBUG: FINAL response headers for client',
        JSON.stringify(serverResponse.getHeaders(), null, 2)
      );

      console.log('DEBUG: FINAL status code for client', serverResponse.statusCode);
    }
  });

  // If the request URL contains any of the excluded rewrite routes and
  // the request is not a layout service request whose response data can be transformed,
  // we assume the response does not need to be server rendered or transformed.
  // Instead, the response should just be relayed without additional modification.
  if (
    urlShouldNotBeRewritten(request.originalUrl, config, true) &&
    !isTransformableLayoutServiceRequest(request.originalUrl, config)
  ) {
    // give us a chance to do things before the response is written and ended.
    // note: emit is synchronous and calls listeners synchronously, so any listeners
    // that are async or perform async operations won't complete before the next tick.
    emitter.emit('before-response-write');
    // When http-proxy `selfHandleResponse` is true, we need to pipe the proxy response to the server response.
    proxyResponse.pipe(serverResponse);
    // note: you do not need to call serverResponse.end() here.
    return;
  }

  // buffer the response body as it is written so that we can modify it or use it for rendering
  const responseDataWriter = { output: Buffer.from('') };
  proxyResponse.on('data', readResponseBody(responseDataWriter, config));

  // As the response is ending, determine how to handle the response content, e.g. transform it or use it for rendering
  proxyResponse.on('end', async () => {
    const contentEncoding = proxyResponse.headers['content-encoding'];

    // extract the "raw" (albeit decoded) JSON data from the response
    const extractedLayoutServiceData = await extractJsonFromResponseData(
      responseDataWriter.output,
      config,
      proxyResponse.statusCode,
      contentEncoding
    );
    if (!extractedLayoutServiceData) {
      throw new Error(
        `Received invalid response ${proxyResponse.statusCode} ${proxyResponse.statusMessage}`
      );
    }

    // If the response data is gzip or deflate, assume we've decompressed it for processing/manipulation
    // and therefore need to remove the `content-encoding` header from the outgoing response because
    // the outgoing response will not be encoded (at least not by this proxy middleware).
    // Note: because of the `defaultResponseModifier` method, all the proxy response headers have been
    // copied to the server response by this point.
    if (
      contentEncoding &&
      (contentEncoding.indexOf('gzip') !== -1 || contentEncoding.indexOf('deflate') !== -1)
    ) {
      serverResponse.removeHeader('content-encoding');
    }

    // If a custom layout service transform function has been defined, we want the function
    // to fulfill its glorious destiny for both proxied layout service requests and
    // for requests that will be SSR'd.
    let layoutServiceData: object | string = extractedLayoutServiceData;
    if (config.transformLayoutServiceData) {
      layoutServiceData = await config.transformLayoutServiceData(
        extractedLayoutServiceData,
        request,
        serverResponse,
        proxyResponse
      );
    }

    // If the request URL contains the layout service endpoint path and
    // a custom layout service transform function has been defined,
    // then complete the response using the transformed layout service data.
    if (isTransformableLayoutServiceRequest(request.originalUrl, config)) {
      if (config.debug) {
        console.log(
          `DEBUG: layout service request was transformed, returning transformed data for URL '${
            request.originalUrl
          }'`
        );
      }

      try {
        // layoutServiceData is likely an object, and if defined we need to stringify it
        // before passing to `completeResponse`, which accepts a Buffer or string.
        // There may be an opportunity for more type-checking here to make it more "robust"
        // for careless devs, but...
        layoutServiceData = layoutServiceData ? JSON.stringify(layoutServiceData) : '';

        const finalStatusCode = proxyResponse.statusCode || 200;

        completeResponse(layoutServiceData, finalStatusCode, serverResponse, emitter);
      } catch (error) {
        return replyWithError(error, proxyResponse, config, serverResponse, emitter);
      }
    }

    // You may be asking: why do we need to render the app here? why not just pass the JSON response
    // to another piece of middleware that will render the app?
    // Answer: the proxy middleware ends the response and does not "chain", i.e. call `next()`
    try {
      const renderAppResult = await renderApp(
        layoutServiceData,
        proxyResponse,
        request,
        serverResponse,
        renderer,
        config
      );

      let html = renderAppResult.renderingResult.html;

      // Provide developers with an opportunity to transform the rendered app
      // html before we complete the response.
      if (config.transformSSRContent) {
        html = await config.transformSSRContent(
          renderAppResult.renderingResult,
          request,
          serverResponse
        );
      }
      // in summary, we parsed the proxy response body which is JSON, then
      // render the app using that JSON, but return HTML to the final response.
      completeResponse(
        html,
        renderAppResult.statusCode,
        serverResponse,
        emitter,
        renderAppResult.headers
      );
    } catch (error) {
      return replyWithError(error, proxyResponse, config, serverResponse, emitter);
    }
  });
}

function readResponseBody(responseDataWriter: { output: Buffer }, config: ProxyConfig) {
  return (data: any) => {
    if (Buffer.isBuffer(data)) {
      responseDataWriter.output = Buffer.concat([responseDataWriter.output, data]); // append raw buffer
    } else {
      // blurg... ReadableStream.on('data') does not pass in `encoding` as an argument
      // to the data handler callback. So if the data chunk is a string, we don't know
      // the encoding. Probably not that big of a deal if we can _assume_ UTF-8 encoding,
      // but is that a fair assumption?
      responseDataWriter.output = Buffer.concat([responseDataWriter.output, Buffer.from(data)]); // append string with optional character encoding (default utf8)
    }

    // sanity check: if the response is huge, bail.
    // ...we don't want to let someone bring down the server by filling up all our RAM.
    if (responseDataWriter.output.length > (config.maxResponseSizeBytes as number)) {
      throw new Error('Document too large');
    }
  };
}

export function rewriteRequestPath(
  reqPath: string,
  req: any,
  config: ProxyConfig,
  parseRouteUrl?: RouteUrlParser
) {
  // the path comes in URL-encoded by default,
  // but we don't want that because...
  // 1. We need to URL-encode it before we send it out to the Layout Service, if it matches a route
  // 2. We don't want to force people to URL-encode ignored routes, etc (just use spaces instead of %20, etc)
  const decodedReqPath = decodeURIComponent(reqPath);

  // if the request URL contains a path/route that should not be re-written, then just pass it along as-is
  if (urlShouldNotBeRewritten(decodedReqPath, config)) {
    // we do not return the decoded URL because we're using it verbatim - should be encoded.
    return reqPath;
  }

  // if the request URL doesn't contain the layout service controller path, assume we need to rewrite the request URL so that it does
  // if this seems redundant, it is. the config.pathRewriteExcludeRoutes should contain the layout service path, but can't always assume that it will...
  if (decodedReqPath.indexOf(config.layoutServiceRoute) !== -1) {
    return reqPath;
  }

  let finalReqPath = decodedReqPath;
  const qsIndex = finalReqPath.indexOf('?');
  let qs;
  if (qsIndex > -1) {
    qs = buildQueryString(req.query);
    finalReqPath = finalReqPath.slice(0, qsIndex);
  }

  if (config.qsParams) {
    qs += `&${config.qsParams}`;
  }

  let lang;
  if (parseRouteUrl) {
    if (config.debug) {
      console.log(`DEBUG: Parsing route URL using ${decodedReqPath} URL...`);
    }
    const routeParams = parseRouteUrl(decodedReqPath);

    if (routeParams) {
      if (routeParams.sitecoreRoute) {
        finalReqPath = routeParams.sitecoreRoute;
      } else {
        finalReqPath = '/';
      }
      if (!finalReqPath.startsWith('/')) {
        finalReqPath = `/${finalReqPath}`;
      }
      lang = routeParams.lang;

      if (routeParams.qsParams) {
        qs += `&${routeParams.qsParams}`;
      }

      if (config.debug) {
        console.log(`DEBUG: parseRouteUrl() result`, routeParams);
      }
    }
  }

  let path = `${config.layoutServiceRoute}?item=${encodeURIComponent(finalReqPath)}&sc_apikey=${
    config.apiKey
  }`;

  if (lang) {
    path = `${path}&sc_lang=${lang}`;
  }

  if (qs) {
    path = `${path}&${qs}`;
  }

  return path;
}

function urlShouldNotBeRewritten(
  originalUrl: string,
  config: ProxyConfig,
  noDebug: boolean = false
): boolean {
  if (config.pathRewriteExcludePredicate && config.pathRewriteExcludeRoutes) {
    console.error(
      'ERROR: pathRewriteExcludePredicate and pathRewriteExcludeRoutes were both provided in config. Provide only one.'
    );
    process.exit(1);
  }

  let result = null;

  if (config.pathRewriteExcludeRoutes) {
    const matchRoute = decodeURIComponent(originalUrl).toUpperCase();
    result = config.pathRewriteExcludeRoutes.find(
      (excludedRoute: string) => excludedRoute.length > 0 && matchRoute.startsWith(excludedRoute)
    );

    if (!noDebug && config.debug && !result) {
      console.log(
        `DEBUG: URL ${originalUrl} did not match the rewrite exclude list, so it will be re-written as a layout service request, which will be sent to the Sitecore server and the response will be treated as a layout service route to render. Excludes:`,
        config.pathRewriteExcludeRoutes
      );
    } else if (!noDebug) {
      console.log(
        `DEBUG: URL ${originalUrl} matched the rewrite exclude list, so it will be proxied "directly" to the Sitecore server and the response will be served verbatim as received. Excludes: `,
        config.pathRewriteExcludeRoutes
      );
    }

    return result ? true : false;
  }

  if (config.pathRewriteExcludePredicate) {
    result = config.pathRewriteExcludePredicate(originalUrl);

    if (config.debug && !result) {
      console.log(
        `DEBUG: URL ${originalUrl} did not match the rewrite exclude function, so it will be re-written as a layout service request, which will be sent to the Sitecore server and the response will be treated as a layout service route to render..`
      );
    } else {
      console.log(
        `DEBUG: URL ${originalUrl} matched the rewrite exclude function, so it will be proxied "directly" to the Sitecore server and the response will be served verbatim as received..`
      );
    }

    return result;
  }

  return false;
}

function createOptions(
  renderer: AppRenderer,
  config: ProxyConfig,
  parseRouteUrl: RouteUrlParser
): proxy.Config {
  if (!config.maxResponseSizeBytes) {
    config.maxResponseSizeBytes = 10 * 1024 * 1024;
  }

  // ensure all excludes are case insensitive
  if (config.pathRewriteExcludeRoutes && Array.isArray(config.pathRewriteExcludeRoutes)) {
    config.pathRewriteExcludeRoutes = config.pathRewriteExcludeRoutes.map((exclude) =>
      exclude.toUpperCase()
    );
  }

  if (config.debug) {
    console.log('DEBUG: Final proxy config', config);
  }

  const options: proxy.Config = {
    target: config.apiHost,
    changeOrigin: true, // required otherwise need to include CORS headers
    ws: true,
    pathRewrite: (reqPath, req) => rewriteRequestPath(reqPath, req, config, parseRouteUrl),
    logLevel: config.debug ? 'debug' : 'info',
    selfHandleResponse: true,
    ...config.proxyOptions,
  };

  options.onProxyRes = (proxyRes, req, res) =>
    handleProxyResponse(proxyRes, req, res, renderer, config, options);

  return options;
}

export default function scProxy(
  renderer: AppRenderer,
  config: ProxyConfig,
  parseRouteUrl: RouteUrlParser
) {
  const options = createOptions(renderer, config, parseRouteUrl);
  return proxy(options);
}

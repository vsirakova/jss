import { IncomingMessage } from 'http';
import proxy from 'http-proxy-middleware';
import { parse as urlParser } from 'url';
import { AppRenderer } from './AppRenderer';
import { createDefaultLogger } from './defaultLogger';
import { Logger } from './Logger';
import { ParsedRequest } from './ParsedRequest';
import { ProxyConfig } from './ProxyConfig';
import { defaultProxyRequestPathRewriter as rewriteRequestPath } from './proxyHandler/defaultProxyRequestPathRewriter';
import { defaultProxyResponseHandlerFactory } from './proxyHandler/defaultProxyResponseHandlerFactory';
import { removeEmptyAnalyticsCookie } from './proxyHandler/proxyResponseHelpers';

import { RouteUrlParser } from './RouteUrlParser';

// exporting these to maintain legacy interface. gross.
// todo: should be removed for next major release.
export { removeEmptyAnalyticsCookie, rewriteRequestPath };

export default function scProxy(
  renderer: AppRenderer,
  config: ProxyConfig,
  parseRouteUrl: RouteUrlParser
) {
  const logger = config.logger || createDefaultLogger(config);

  validateConfig(config, logger);

  const options = createOptions(renderer, config, parseRouteUrl, logger);
  return proxy(options);
}

// Use this function to validate configuration options before creating proxy middleware.
function validateConfig(config: ProxyConfig, logger: Logger) {
  if (config.pathRewriteExcludePredicate && config.pathRewriteExcludeRoutes) {
    const error = new Error(
      'pathRewriteExcludePredicate and pathRewriteExcludeRoutes were both provided in config. Provide only one.'
    );
    logger.log('error', error);
    throw error;
  }
}

function createOptions(
  renderer: AppRenderer,
  config: ProxyConfig,
  parseRouteUrl: RouteUrlParser,
  logger: Logger
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

  logger.log('debug', 'Final proxy config', config);

  const requestPathRewriter = config.proxyRequestPathRewriter || rewriteRequestPath;

  const options: proxy.Config = {
    target: config.apiHost,
    changeOrigin: true, // required otherwise need to include CORS headers
    ws: true,
    pathRewrite: (reqPath, req) =>
      requestPathRewriter(reqPath, parseRequest(req), config, parseRouteUrl, logger),
    logLevel: config.debug ? 'debug' : 'info', // affects logging within the http-proxy-middleware
    selfHandleResponse: true,
    ...config.proxyOptions,
  };

  // We assign the `config.proxyOptions` above, so if an `onProxyRes` function
  // has been defined by devs in the config options, then we leave it alone and allow
  // that function to handle proxy responses. Otherwise, attach our handler.
  if (!options.onProxyRes) {
    // Re-assign the updated `proxyOptions` property to the config object.
    // This provides access to the "final" options config within the response handler.
    config.proxyOptions = options;

    options.onProxyRes = (proxyRes, req, res) => {
      const handlerFactory = config.proxyResponseHandlerFactory
        ? config.proxyResponseHandlerFactory
        : defaultProxyResponseHandlerFactory;

      const request = parseRequest(req);
      const handler = handlerFactory(proxyRes, request, config, logger);
      handler({
        config,
        logger,
        proxyResponse: proxyRes,
        request,
        serverResponse: res,
        appRenderer: renderer,
      });
    };
  }

  return options;
}

function parseRequest(request: IncomingMessage) {
  // Tried to use spread here to assign `parsedUrl` to `req`, but TS complained...
  const parsedRequest: ParsedRequest = Object.assign(request, {
    parsedUrl: urlParser(request.url as any, true),
  });
  return parsedRequest;
}

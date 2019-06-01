import { Logger } from '../Logger';
import { ParsedRequest } from '../ParsedRequest';
import { ProxyConfig } from '../ProxyConfig';
import { RouteUrlParser } from '../RouteUrlParser';
import { buildQueryString } from '../util';

// tslint:disable:max-line-length

export type RequestPathRewriter = (
  reqPath: string,
  req: ParsedRequest,
  config: ProxyConfig,
  parseRouteUrl?: RouteUrlParser,
  logger?: Logger
) => string;

// The `logger` argument initializer is used to prevent breaking the existing `rewriteRequestPath` interface.
// In order for `logger` to be added after the optional `parseRouteUrl` argument,
// the `logger` argument needs to be optional as well, but we don't really want it to be optional.
// todo: make `logger` argument required, remove initializer
export function defaultProxyRequestPathRewriter(
  reqPath: string,
  req: ParsedRequest,
  config: ProxyConfig,
  parseRouteUrl?: RouteUrlParser,
  logger: Logger = {
    log: (level: string, msg: any, ...args: any[]) => {
      return;
    },
  }
) {
  // the path comes in URL-encoded by default,
  // but we don't want that because...
  // 1. We need to URL-encode it before we send it out to the Layout Service, if it matches a route
  // 2. We don't want to force people to URL-encode ignored routes, etc (just use spaces instead of %20, etc)
  const decodedReqPath = decodeURIComponent(reqPath);

  // if the request URL contains a path/route that should not be re-written, then just pass it along as-is
  if (urlShouldNotBeRewritten(decodedReqPath, config)) {
    logger.log(
      'debug',
      `URL ${decodedReqPath} did not match the rewrite exclude list or the rewrite exclude function, so it will be re-written as a layout service request, which will be sent to the Sitecore server and the response will be treated as a layout service route to render. Excludes: `,
      config.pathRewriteExcludeRoutes
    );

    // we do not return the decoded URL because we're using it verbatim - should be encoded.
    return reqPath;
  }
  logger.log(
    'debug',
    `URL ${decodedReqPath} matched the rewrite exclude list or the rewrite exclude function, so it will be proxied "directly" to the Sitecore server and the response will be served verbatim as received. Excludes: `,
    config.pathRewriteExcludeRoutes
  );

  // if the request URL doesn't contain the layout service controller path, assume we need to rewrite the request URL so that it does
  // if this seems redundant, it is. the config.pathRewriteExcludeRoutes should contain the layout service path, but can't always assume that it will...
  if (decodedReqPath.indexOf(config.layoutServiceRoute) !== -1) {
    return reqPath;
  }

  let finalReqPath = decodedReqPath;
  const qsIndex = finalReqPath.indexOf('?');
  let qs;
  if (qsIndex > -1) {
    qs = buildQueryString(req.parsedUrl.query);
    finalReqPath = finalReqPath.slice(0, qsIndex);
  }

  if (config.qsParams) {
    qs += `&${config.qsParams}`;
  }

  let lang;
  if (parseRouteUrl) {
    logger.log('debug', `Parsing route URL using ${decodedReqPath} URL...`);
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

      logger.log('debug', `parseRouteUrl() result`, routeParams);
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

export function urlShouldNotBeRewritten(originalUrl: string, config: ProxyConfig): boolean {
  if (config.pathRewriteExcludeRoutes) {
    const matchRoute = decodeURIComponent(originalUrl).toUpperCase();
    const excluded = config.pathRewriteExcludeRoutes.find(
      (excludedRoute: string) =>
        excludedRoute.length > 0 && matchRoute.startsWith(excludedRoute.toUpperCase())
    );

    return excluded ? true : false;
  }

  if (config.pathRewriteExcludePredicate) {
    const excluded = config.pathRewriteExcludePredicate(originalUrl);
    return excluded;
  }

  return false;
}

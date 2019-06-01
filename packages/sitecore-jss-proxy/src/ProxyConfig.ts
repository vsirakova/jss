import { ServerResponse } from 'http';
import { Config as HttpProxyConfig } from 'http-proxy-middleware';
import { Logger } from './Logger';
import { ParsedRequest } from './ParsedRequest';
import { RequestPathRewriter } from './proxyHandler/defaultProxyRequestPathRewriter';
import {
  ProxyResponseHandler,
  ProxyResponseHandlerFactory,
  ReadonlyProxyResponse,
  ReadonlyServerResponse,
} from './proxyHandler/proxyResponseHelpers';

import { RenderResponse } from './RenderResponse';

export interface ProxyConfig {
  /** Hostname to proxy to (i.e. Sitecore CD server 'http://siteco.re') */
  apiHost: string;
  /** Path to layout service endpoint on proxy target server */
  layoutServiceRoute: string;
  /** SSC endpoint to use when sending Layout Service requests to proxy */
  apiKey: string;
  /** Custom Query String parameters to send to Layout Service, e.g. sc_site=my-site&tracing=false */
  qsParams?: string;
  /**
   * Array of paths to proxy without any SSR transformation (i.e. do not treat as app routes).
   * Note: exclusions are case-insensitive.
   * Mutually exclusive with pathRewriteExcludePredicate.
   */
  pathRewriteExcludeRoutes?: string[];
  /**
   * Function to determine if a given URL should be SSRed (return true), or passed through (return false)
   * Mutually exclusive with pathRewriteExcludeRoutes.
   */
  pathRewriteExcludePredicate?: (originalUrl: string) => boolean;
  /** Configure `http-proxy-middleware` */
  proxyOptions?: HttpProxyConfig;
  /** Enables or disables proxy diagnostics in Logger (disable for production or get bad performance) */
  debug?: boolean;
  /** Callback when an exception is thrown during SSR; decides what to send back to client (500 errors) */
  onError?: (
    error: Error,
    proxyResponse: ReadonlyProxyResponse,
    logger?: Logger
  ) => Promise<{ statusCode?: number; content?: string }>;
  /** Enables transforming SSR'ed HTML after it is rendered, i.e. to replace paths. */
  transformSSRContent?: (
    response: RenderResponse,
    request: ParsedRequest,
    serverResponse: ReadonlyServerResponse
  ) => Promise<string>;
  /** Hook to fill the SSR viewBag object; if you're customizing the viewBag in Sitecore integrated SSR mode, do the same here. */
  createViewBag?: (
    request: ParsedRequest,
    serverResponse: ReadonlyServerResponse,
    proxyResponse: ReadonlyProxyResponse,
    layoutServiceData: any
  ) => Promise<object>;
  /** Hook to alter HTTP headers in a custom way. */
  setHeaders?: (
    request: ParsedRequest,
    serverResponse: ServerResponse,
    proxyResponse: ReadonlyProxyResponse
  ) => void;
  /** Responses from the proxy greater than this size (in bytes) are rejected. */
  maxResponseSizeBytes?: number;
  /** Hook to transform or modify layout service data after it is retrieved from Sitecore
   * and before it is delivered as a response or passed as an argument to the AppRenderer.
   */
  transformLayoutServiceData?: LayoutServiceDataTransformer;
  logger?: Logger;
  proxyResponseHandlerFactory?: ProxyResponseHandlerFactory;
  pipeableResponseHandler?: ProxyResponseHandler;
  layoutServiceResponseHandler?: ProxyResponseHandler;
  ssrResponseHandler?: ProxyResponseHandler;
  proxyRequestPathRewriter?: RequestPathRewriter;
}

export type LayoutServiceDataTransformer = (
  layoutServiceData: any,
  request: ParsedRequest,
  proxyResponse: ReadonlyProxyResponse
) => Promise<any>;

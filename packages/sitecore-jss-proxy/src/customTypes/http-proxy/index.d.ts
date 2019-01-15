// Augment the existing `http-proxy` type definition with some methods from "private" types within `http-proxy`
// https://github.com/nodejitsu/node-http-proxy/blob/master/lib/http-proxy/passes/web-outgoing.js

// Essentially, we want to access the methods in the above-mentioned code in order to handle scenarios
// similar to this issue: https://github.com/nodejitsu/node-http-proxy/issues/1263
// Whereby we may want the default `http-proxy` behavior to occur but still handle some aspects of
// modifying the response. Or we may want to let `http-proxy` handle the response without any modification.
declare module 'http-proxy/lib/http-proxy/passes/web-outgoing' {
  // import statements _within_ the module declaration to make TS happy
  // thanks: https://stackoverflow.com/questions/42388217/having-error-module-name-resolves-to-an-untyped-module-at-when-writing-cu
  import { ClientRequest, IncomingMessage } from 'http';
  import proxy from 'http-proxy';

  export function removeChunked(
    req: ClientRequest,
    res: IncomingMessage,
    proxyRes: IncomingMessage
  ): void;

  export function setConnection(
    req: ClientRequest,
    res: IncomingMessage,
    proxyRes: IncomingMessage
  ): void;

  export function setRedirectHostRewrite(
    req: ClientRequest,
    res: IncomingMessage,
    proxyRes: IncomingMessage,
    options: proxy.ServerOptions
  ): void;

  export function writeHeaders(
    req: ClientRequest,
    res: IncomingMessage,
    proxyRes: IncomingMessage,
    options: proxy.ServerOptions
  ): void;

  export function writeStatusCode(
    req: ClientRequest,
    res: IncomingMessage,
    proxyRes: IncomingMessage
  ): void;
}

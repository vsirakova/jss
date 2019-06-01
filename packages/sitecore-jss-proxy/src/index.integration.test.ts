import express from 'express';
import http, { ClientRequest, ServerResponse } from 'http';
// general import statement makes TS compiler and linter happy when working in *.test.ts files
import 'mocha';
import scProxy from './';
import { AppRenderer } from './AppRenderer';
import { ProxyConfig } from './ProxyConfig';
import { RouteUrlParser } from './RouteUrlParser';

describe('Integration test', () => {
  const apiServerPort = 9516;
  let mockSitecoreServer: http.Server;

  beforeEach(() => {
    const handler = (req: ClientRequest, res: ServerResponse) => {
      const content = JSON.stringify({ sitecore: { context: {}, route: {} } });

      const contentLength = Buffer.byteLength(content);

      res.statusCode = 200;
      // content-length is required when using `http.IncomingMessage.on('data')` listener
      // to read the response we're sending. Otherwise, a `Parse Error` is thrown by the reader.
      res.setHeader('content-length', contentLength);
      res.write(content);
      res.end(); // be sure to call res.end()
    };
    mockSitecoreServer = createHttpServer(apiServerPort, [{ path: '*', middleware: handler }]);
  });

  afterEach(() => {
    mockSitecoreServer.close();
  });

  it.skip('should do something', (done) => {
    const renderer: AppRenderer = (cb, path, data, viewBag) => {
      cb(null, { html: '<html><body>this is my page</body></html>' });
    };

    const proxyConfig: ProxyConfig = {
      apiHost: `http://localhost:${apiServerPort}`,
      layoutServiceRoute: '/sitecore/api/layout/render/jss',
      apiKey: '{3A76F728-74E0-43B6-BAA1-B5814A07AE20}',
      pathRewriteExcludeRoutes: ['/sitecore/api'],
      debug: true,
    };
    const routeUrlParser: RouteUrlParser = (url) => {
      return null;
    };

    const middleware = scProxy(renderer, proxyConfig, routeUrlParser);

    const proxyPort = 9517;
    const proxyServer = createHttpServer(proxyPort, [{ path: '*', middleware }]);

    http.get(`http://localhost:${proxyPort}/some-route`, (res) => {
      const responseDataWriter = { output: Buffer.from('') };
      res.on('data', readResponseBody(responseDataWriter));
      res.on('end', () => {
        console.log('responseBody', responseDataWriter.output.toString('utf-8'));
        // assert some shit
        proxyServer.close();
        done();
      });
      res.on('error', () => {
        console.log('egads, an error!');
        proxyServer.close();
        done();
      });
    });
  });
});

function createHttpServer(port: number, middlewares?: Array<{ path?: string; middleware: any }>) {
  const server = express();

  if (middlewares && Array.isArray(middlewares)) {
    middlewares.forEach((middlewareDefinition) => {
      if (middlewareDefinition.path) {
        server.use(middlewareDefinition.path, middlewareDefinition.middleware);
      } else {
        server.use(middlewareDefinition.middleware);
      }
    });
  }

  return server.listen(port);
}

function readResponseBody(responseDataWriter: { output: Buffer }) {
  return (data: any) => {
    if (Buffer.isBuffer(data)) {
      // append raw buffer
      responseDataWriter.output = Buffer.concat([responseDataWriter.output, data]);
    } else {
      // append string with optional character encoding (default utf8)
      responseDataWriter.output = Buffer.concat([responseDataWriter.output, Buffer.from(data)]);
    }
  };
}

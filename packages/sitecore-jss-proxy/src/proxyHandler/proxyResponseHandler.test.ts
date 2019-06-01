import { expect } from 'chai';
// import { ClientRequest } from 'http';
// general import statement makes TS compiler and linter happy when working in *.test.ts files
import 'mocha';
import MockServerResponse from 'mock-res';
import sinon from 'sinon';
import zlib from 'zlib';
import { Logger } from '../Logger';
import { ProxyConfig } from '../ProxyConfig';
import { extractJsonFromResponseData } from './jsonDataExtractor';
import {
  convertResponseToReadonlyResponse,
  defaultResponseModifier,
  finalizeServerResponse,
  getErrorResponseInfo,
  getLayoutServiceDataFromProxyResponse,
  getReadonlyServerResponse,
  // getResponseInfo,
  isPipeableResponse,
  isTransformableLayoutServiceRequest,
  prepareModifiedContentResponse,
  // ReadonlyProxyResponse,
  // ReadonlyServerResponse,
  readResponseBody,
  removeEmptyAnalyticsCookie,
} from './proxyResponseHandler';

// Ideally, we'd stub/mock the "internal" methods used in the `handleProxyResponseEnd` tests.
// e.g. `completeResponse`, `extractJsonFromResponseData`, etc...
// However, that's not really feasible without something like babel-plugin-rewire.
// And we're not using TypeScript + Babel in this project, so for now we
// just provide services/arguments that will satisfy the "internal" methods.

// replyWithError calls `completeResponse` internally.
// so sure, technically these aren't unit tests. sue me.
// (•_•)
// (•_•)>⌐■-■
// (⌐■_■)
// describe('handleProxyResponseEnd', () => {
//   describe('when content is encoded', () => {
//     it('should remove `content-encoding` header from response', () => {
//       const mockServerResponse: any = new MockResponse();
//       mockServerResponse.setHeader('content-encoding', 'gzip');

//       const responseData = zlib.gzipSync(Buffer.from('{"dilly": "dilly"}'));
//       const mockProxyResponse = {
//         headers: { 'content-encoding': 'gzip' },
//         statusCode: 200,
//       };
//       const mockRequest = { originalUrl: '/' };
//       const mockConfig = { layoutServiceRoute: '/sitecore/api/layout' };
//       const mockAppRenderer = (cb: any) => {
//         cb(null, { html: '<blink />' });
//       };

//       return handleProxyResponseEnd(
//         responseData,
//         mockProxyResponse as any,
//         mockRequest,
//         mockServerResponse,
//         mockAppRenderer as any,
//         mockConfig as any,
//         new EventEmitter()
//       ).then(() => {
//         expect(mockServerResponse._internal.headers['content-encoding']).to.equal(undefined);
//       });
//     });
//   });

//   describe('when response data is invalid', () => {
//     it('should throw', () => {
//       const mockServerResponse: any = new MockResponse();
//       const responseData = Buffer.from('dilly dilly');
//       const mockProxyResponse = { headers: {}, statusCode: 200 };
//       const mockRequest = { originalUrl: '/' };
//       const mockConfig = { layoutServiceRoute: '/sitecore/api/layout' };
//       const mockAppRenderer = (cb: any) => {
//         cb(null, { html: '<blink />' });
//       };

//       return handleProxyResponseEnd(
//         responseData,
//         mockProxyResponse as any,
//         mockRequest,
//         mockServerResponse,
//         mockAppRenderer as any,
//         mockConfig as any,
//         new EventEmitter()
//       ).catch((err) => {
//         expect(err).to.not.equal(undefined);
//       });
//     });
//   });

//   describe('when custom layout service transform function is defined', () => {
//     // The brittleness of this test... 🤮
//     it('should transform data', () => {
//       const mockServerResponse: any = new MockResponse();
//       const responseData = Buffer.from('{"dilly": "dilly"}');
//       const mockProxyResponse = { headers: {}, statusCode: 200 };
//       const mockRequest = { originalUrl: '/' };
//       const mockConfig: Partial<ProxyConfig> = {
//         layoutServiceRoute: '/sitecore/api/layout',
//         transformLayoutServiceData: (data: any, request: any, proxyResponse: any) => {
//           return Promise.resolve({
//             ...data,
//             dilly: 'dally',
//           });
//         },
//       };
//       const mockAppRenderer = sinon.fake((cb: any, route: any, data: any) => {
//         cb(null, {
//           html: '<blink />',
//         });
//       });

//       return handleProxyResponseEnd(
//         responseData,
//         mockProxyResponse as any,
//         mockRequest,
//         mockServerResponse,
//         mockAppRenderer as any,
//         mockConfig as any,
//         new EventEmitter()
//       ).then(() => {
//         expect(mockAppRenderer.calledOnce).to.equal(true);
//         // expect mockAppRenderer to have been called with transformed LS data.
//         expect(mockAppRenderer.args[0][2]).to.eql({
//           dilly: 'dally',
//         });
//       });
//     });
//   });

//   describe('when request is transformable and is a layout service request', () => {
//     const mockServerResponse: any = new MockResponse();
//     const responseData = Buffer.from('{"transformers": "robots in disguise"}');
//     let transformedData = {};
//     const mockProxyResponse = { headers: {}, statusCode: 200 };
//     const mockRequest = { originalUrl: '/sitecore/api/layout/render/jss?item=/' };
//     const mockConfig: Partial<ProxyConfig> = {
//       layoutServiceRoute: '/sitecore/api/layout',
//       transformLayoutServiceData: (data: any, request: any, proxyResponse: any) => {
//         transformedData = { ...data, transformers: 'more than meets the eye' };
//         return Promise.resolve(transformedData);
//       },
//     };
//     const mockAppRenderer = sinon.fake((cb: any, route: any, data: any) => {
//       cb(null, { html: '<blink />' });
//     });
//     it('should respond with layout service data when no errors encountered', () => {
//       return handleProxyResponseEnd(
//         responseData,
//         mockProxyResponse as any,
//         mockRequest,
//         mockServerResponse,
//         mockAppRenderer as any,
//         mockConfig as any,
//         new EventEmitter()
//       ).then(() => {
//         expect(mockServerResponse._internal.buffer.toString()).to.equal(
//           JSON.stringify(transformedData)
//         );
//       });
//     });
//     it('should respond with error if errors encountered', () => {
//       const emitter = new EventEmitter();
//       emitter.on('before-response-write', () => {
//         throw new Error('some shit went down');
//       });
//       return handleProxyResponseEnd(
//         responseData,
//         mockProxyResponse as any,
//         mockRequest,
//         mockServerResponse,
//         mockAppRenderer as any,
//         mockConfig as any,
//         emitter
//       ).catch((err) => {
//         expect(err).to.not.equal(undefined);
//       });
//     });
//   });
// });

describe('getReadonlyServerResponse', () => {
  const serverResponse: any = {
    getHeaders: () => ({ testHeader0: 'eye of', testHeader1: 'the tiger' }),
    statusCode: 418,
    upgrading: true,
  };
  it('should remove function properties', () => {
    const readonly: any = getReadonlyServerResponse(serverResponse);
    expect(readonly['getHeaders']).to.equal(undefined);
  });
  it('should preserve non-function properties', () => {
    const readonly = getReadonlyServerResponse(serverResponse);
    expect(readonly.statusCode).to.equal(serverResponse.statusCode);
    expect(readonly.upgrading).to.equal(serverResponse.upgrading);
  });
  it('should populate headers property', () => {
    const readonly = getReadonlyServerResponse(serverResponse);
    expect(readonly.headers).to.eql(serverResponse.getHeaders());
  });
});

describe('convertResponseToReadonlyResponse', () => {
  const response: any = {
    getHeaders: () => ({ testHeader0: 'eye of', testHeader1: 'the tiger' }),
    statusCode: 418,
    upgrading: true,
  };
  it('should remove function properties', () => {
    const readonly: any = convertResponseToReadonlyResponse(response);
    expect(readonly['getHeaders']).to.equal(undefined);
  });
  it('should preserve non-function properties', () => {
    const readonly: any = convertResponseToReadonlyResponse(response);
    expect(readonly.statusCode).to.equal(response.statusCode);
    expect(readonly.upgrading).to.equal(response.upgrading);
  });
  it('should invoke onBeforeFreeze', () => {
    const onBeforeFreeze = (convertedResponse: any) => {
      convertedResponse.headers = { custom: 'value' };
    };
    const readonly: any = convertResponseToReadonlyResponse(response, onBeforeFreeze);
    expect(readonly.headers).to.eql({ custom: 'value' });
  });
});

describe('isPipeableResponse', () => {
  const mockConfig: Partial<ProxyConfig> = {
    layoutServiceRoute: '/sitecore/api/layout/render/jss',
    pathRewriteExcludeRoutes: ['/sitecore/api', '/-/media'],
  };

  it('should return true for non-re-writeable url and non-transformable LS request', () => {
    const mockRequest: any = {
      originalUrl: '/-/media/jss-cat.gif',
    };
    expect(isPipeableResponse(mockRequest, mockConfig as any)).to.equal(true);
  });
  it('should return false for re-writeable url', () => {
    const mockRequest: any = {
      originalUrl: '/route%20name',
    };
    expect(isPipeableResponse(mockRequest, mockConfig as any)).to.equal(false);
  });
  it('should return false for transformable LS request', () => {
    const mockRequest: any = {
      originalUrl: '/SiteCore/api/layout/render/jss?item=/my-route&sc_apikey={blah}',
    };
    mockConfig.transformLayoutServiceData = (lsData: any, res: any, req: any) =>
      Promise.resolve('i am defined');
    expect(isPipeableResponse(mockRequest, mockConfig as any)).to.equal(false);
  });
});

describe.only('getLayoutServiceDataFromProxyResponse', () => {
  it('should throw when data are shite', () => {
    const mockJsonDataExtractor = sinon.fake.returns(undefined);

    return getLayoutServiceDataFromProxyResponse(
      Buffer.from(''),
      { headers: {} } as any,
      {} as any,
      {} as any,
      mockJsonDataExtractor
    ).catch((err) => {
      expect(err).to.not.equal(undefined);
      expect(err.message).to.contain('Received invalid response');
    });
  });

  it('should pass content encoding to data extractor', () => {
    
  });
});

describe('finalizeServerResponse', () => {
  const mockLogger: Logger = {
    log: (level: string, msg: any) => {},
  };
  it('should remove `server` header', () => {
    const mockResponse: any = new MockServerResponse();
    mockResponse.setHeader('server', 'adobe jrun');
    finalizeServerResponse(mockResponse, {} as any, {} as any, {} as any, mockLogger);
    expect(mockResponse._headers['server']).to.equal(undefined);
  });
  it('should set headers provided by custom `setHeaders` function', () => {
    const mockResponse: any = new MockServerResponse();
    const testHeader = {
      name: 'my-custom-header',
      value: 'is-awesome',
    };
    const mockConfig: any = {
      setHeaders: (request: any, serverResponse: any, proxyResponse: any) => {
        serverResponse.setHeader(testHeader.name, testHeader.value);
      },
    };
    finalizeServerResponse(mockResponse, {} as any, {} as any, mockConfig, mockLogger);
    expect(mockResponse._headers[testHeader.name]).to.equal(testHeader.value);
  });
});

describe('removeEmptyAnalyticsCookie', () => {
  it('should remove empty analytics cookie from response headers', () => {
    const mockResponse = {
      headers: {
        'set-cookie': [
          'SC_ANALYTICS_GLOBAL_COOKIE=; expires=Wed, 17-Mar-2027 14:28:58 GMT; path=/; HttpOnly',
        ],
      },
    };

    const expected = {
      headers: {
        'set-cookie': [],
      },
    };

    removeEmptyAnalyticsCookie(mockResponse);

    expect(mockResponse).to.eql(expected);
  });
});

describe('defaultResponseModifier', () => {
  it('should invoke web-outgoing methods', () => {
    const method1 = sinon.spy();
    const method2 = sinon.spy();
    const mockWebOutgoingMethods = [method1, method2];
    const mockArgs = ['mock request', 'mock server response', 'mock proxy response', 'mock config'];
    defaultResponseModifier(
      mockWebOutgoingMethods,
      mockArgs[0] as any,
      mockArgs[1] as any,
      mockArgs[2] as any,
      mockArgs[3] as any
    );
    expect(method1.calledOnceWith(...mockArgs)).to.equal(true);
    expect(method2.calledOnceWith(...mockArgs)).to.equal(true);
  });
});

describe('isTransformableLayoutServiceRequest', () => {
  const mockConfig: any = {
    layoutServiceRoute: '/sitecore/api/layout/render/jss',
  };

  it('should return true for matching url and config', () => {
    const url = '/SiteCore/api/layout/render/jss?item=/my-route&sc_apikey={blah}';
    mockConfig.transformLayoutServiceData = () => 'i am defined';
    expect(isTransformableLayoutServiceRequest(url, mockConfig as any)).to.equal(true);
  });
  it('should return false for non-matching url', () => {
    const url = '/-/media/my-gif.j2k';
    mockConfig.transformLayoutServiceData = () => 'i am defined';
    expect(isTransformableLayoutServiceRequest(url, mockConfig as any)).to.equal(false);
  });
  it('should return false for non-existent transform function', () => {
    const url = '/SiteCore/api/layout/render/jss?item=/my-route&sc_apikey={blah}';
    expect(isTransformableLayoutServiceRequest(url, mockConfig as any)).to.equal(true);
  });
});

describe('readResponseBody', () => {
  describe('when response data is string', () => {
    it('should write response data to output buffer', () => {
      const writer = {
        output: Buffer.from(''),
      };
      const responseData = 'some string data';
      readResponseBody(writer, {} as any)(responseData);
      expect(writer.output).to.eql(Buffer.from(responseData));
    });
  });
  describe('when response data is Buffer', () => {
    it('should write response data to output buffer', () => {
      const writer = { output: Buffer.from('') };
      const responseData = Buffer.from('some string data');
      readResponseBody(writer, {} as any)(responseData);
      expect(writer.output).to.eql(responseData);
    });
  });
  describe('when response data size exceeds maxResponseSizeBytes', () => {
    it('should throw an error', () => {
      const writer = { output: Buffer.from('') };
      const responseData = Buffer.from('big data is everywhere');
      const mockConfig = { maxResponseSizeBytes: 16 };
      expect(() => {
        readResponseBody(writer, mockConfig as any)(responseData);
      }).to.throw();
    });
  });
});

describe('extractJsonFromResponseData', () => {
  const stringData = '{"sitecore":{"context":{"site":"test"},"route":{"name":"home"}}}';
  const mockLogger: Logger = {
    log: (level: string, msg: any) => {},
  };
  describe('when content is encoded', () => {
    it('should return decoded, parsed JSON', () => {
      const responseData = zlib.gzipSync(Buffer.from(stringData));
      const expectedResult = JSON.parse(stringData);
      return extractJsonFromResponseData(responseData, mockLogger, 'gzip').then((val) => {
        expect(val).to.eql(expectedResult);
      });
    });
  });
  describe('when content is not encoded', () => {
    it('should return parsed JSON', () => {
      const responseData = Buffer.from(stringData);
      const expectedResult = JSON.parse(stringData);

      return extractJsonFromResponseData(responseData, mockLogger).then((val) => {
        expect(val).to.eql(expectedResult);
      });
    });
  });
});

describe('getErrorResponseInfo', () => {
  const mockLogger: Logger = {
    log: (level: string, msg: any) => {},
  };
  it('should use proxyResponse status if provided', () => {
    const mockProxyResponse: any = {
      statusCode: 451,
      statusMessage: 'Unavailable For Legal Reasons',
    };

    return getErrorResponseInfo(new Error(), mockProxyResponse, {} as any, mockLogger).then(
      (info) => {
        expect(info.statusCode).to.equal(mockProxyResponse.statusCode);
        expect(info.content).to.equal(mockProxyResponse.statusMessage);
      }
    );
  });

  it('should use default status code if proxy status not provided', () => {
    return getErrorResponseInfo(new Error(), {} as any, {} as any, mockLogger).then((info) => {
      expect(info.statusCode).to.equal(500);
    });
  });

  it('should use config-provided error handler if provided', () => {
    const mockOnErrorResult = {
      statusCode: 403,
      content: 'Forbidden',
    };
    const proxyConfig = {
      onError: (error: any, proxyResponse: any) => mockOnErrorResult,
    };
    const mockError = new Error();
    const mockProxyResponse = { statusCode: 418 };
    const spy = sinon.spy(proxyConfig, 'onError');
    return getErrorResponseInfo(
      mockError,
      mockProxyResponse as any,
      proxyConfig as any,
      mockLogger
    ).then((info) => {
      expect(info.statusCode).to.equal(mockOnErrorResult.statusCode);
      expect(info.content).to.equal(mockOnErrorResult.content);
      expect(spy.withArgs(mockError, mockProxyResponse).calledOnce);
    });
  });
});

describe('prepareModifiedContentResponse', () => {
  let response: any;

  beforeEach(() => {
    response = new MockServerResponse();
  });

  describe('when content is string', () => {
    const content = 'some string content';
    const contentLength = Buffer.byteLength(content);

    it('should set correct content-length header', () => {
      prepareModifiedContentResponse(content, response);
      expect(response._headers['content-length']).to.equal(contentLength);
    });
  });

  describe('when content is Buffer', () => {
    const content = Buffer.from([0x4a, 0x53, 0x53]);
    const contentLength = content.byteLength;
    it('should set correct content-length header', () => {
      prepareModifiedContentResponse(content, response);
      expect(response._headers['content-length']).to.equal(contentLength);
    });
  });

  it('should set custom headers', () => {
    const headers = {
      'x-my-rad-header': 'is da bomb',
    };
    prepareModifiedContentResponse('', response, headers);
    expect(response._headers).to.contain(headers);
  });

  it('should remove content-encoding header', () => {
    prepareModifiedContentResponse('', response);
  });
});

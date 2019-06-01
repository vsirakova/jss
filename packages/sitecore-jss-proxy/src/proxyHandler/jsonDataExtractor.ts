import zlib from 'zlib'; // node.js standard lib
import { Logger } from '../Logger';
import { tryParseJson } from '../util';

export type DataExtractor = (
  responseData: Buffer,
  logger: Logger,
  contentEncoding?: string
) => Promise<object>;

export const extractJsonFromResponseData: DataExtractor = (
  responseData: Buffer,
  logger: Logger,
  contentEncoding?: string
): Promise<object> => {
  let responseString: Promise<string>;

  if (
    contentEncoding &&
    (contentEncoding.indexOf('gzip') !== -1 || contentEncoding.indexOf('deflate') !== -1)
  ) {
    responseString = new Promise((resolve, reject) => {
      logger.log('debug', 'Layout service response is compressed; decompressing.');

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
};

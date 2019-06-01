import { IncomingMessage } from 'http';
import { UrlWithParsedQuery } from 'url';

export interface ParsedRequest extends IncomingMessage {
  parsedUrl: UrlWithParsedQuery;
}

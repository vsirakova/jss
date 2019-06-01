import { Logger } from './Logger';
import { ProxyConfig } from './ProxyConfig';

export const createDefaultLogger = (config: ProxyConfig): Logger => {
  return {
    log: (level: string = 'info', msg: any, ...args: any[]) => {
      // disable logging by default unless `debug` config option is true
      if (!config || !config.debug) {
        return;
      }

      const formattedLevel = level.toUpperCase();
      switch (formattedLevel) {
        case 'WARN': {
          console.warn(`WARN: ${msg}`, ...args);
          break;
        }
        case 'ERROR': {
          console.error(`ERROR: ${msg}`, ...args);
          break;
        }
        default: {
          console.log(`${formattedLevel}: ${msg}`, ...args);
        }
      }
    },
  };
};

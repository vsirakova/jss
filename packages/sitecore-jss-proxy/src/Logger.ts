export interface Logger {
  log: (level: string, msg: any, ...args: any[]) => void;
}

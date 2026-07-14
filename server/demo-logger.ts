export interface DemoLogEvent {
  event: 'browser_open_failed' | 'request_complete' | 'server_listening' | 'startup_failed';
  requestId?: string;
  method?: string;
  path?: string;
  status?: number;
  port?: number;
}

export interface DemoLogger {
  info(event: DemoLogEvent): void;
  warn(event: DemoLogEvent): void;
  error(event: DemoLogEvent): void;
}

export function createProcessLogger(): DemoLogger {
  const write = (stream: NodeJS.WriteStream, level: string, event: DemoLogEvent): void => {
    stream.write(`${JSON.stringify({ level, ...event })}\n`);
  };
  return {
    info: (event) => write(process.stdout, 'info', event),
    warn: (event) => write(process.stderr, 'warn', event),
    error: (event) => write(process.stderr, 'error', event),
  };
}

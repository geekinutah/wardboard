import process from 'node:process';
import { ConfigError, parseConfig, startServer } from './index.ts';

async function main(): Promise<void> {
  let config;
  try {
    config = parseConfig(process.env);
  } catch (error: unknown) {
    if (error instanceof ConfigError) {
      console.error(error.message);
      process.exit(1);
    }
    throw error;
  }

  const running = await startServer(config);
  console.log(running.url);

  let shuttingDown = false;
  const shutdown = (): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    void running.close().then(
      () => {
        process.exit(0);
      },
      () => {
        process.exit(1);
      },
    );
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

try {
  await main();
} catch (error: unknown) {
  console.error(error instanceof Error ? error.message : 'Server failed to start');
  process.exit(1);
}

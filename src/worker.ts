import 'dotenv/config';
import { loadConfig } from './config';
import { buildContainer } from './container';

const c = buildContainer(loadConfig());
void c.worker.start();

let closing = false;
async function shutdown(signal: string): Promise<void> {
  if (closing) return;
  closing = true;
  c.logger.info({ signal }, 'worker encerrando');
  setTimeout(() => process.exit(1), 15_000).unref();
  await c.worker.stop();
  await c.close();
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('unhandledRejection', (err) => c.logger.error({ err }, 'unhandledRejection'));

import 'dotenv/config';
import { loadConfig } from './config';
import { buildContainer } from './container';
import { createApp } from './app';

const config = loadConfig();
const c = buildContainer(config);
const app = createApp(c);

const server = app.listen(config.PORT, () => c.logger.info({ port: config.PORT, inlineWorker: config.WORKER_INLINE }, 'API no ar'));
server.keepAliveTimeout = 65_000; // > idle timeout típico de load balancers
if (config.WORKER_INLINE) void c.worker.start();

let closing = false;
async function shutdown(signal: string): Promise<void> {
  if (closing) return;
  closing = true;
  c.logger.info({ signal }, 'encerrando');
  const force = setTimeout(() => process.exit(1), 15_000);
  force.unref();
  await new Promise<void>((r) => server.close(() => r())); // para de aceitar e drena requisições em andamento
  await c.worker.stop();
  await c.close();
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('unhandledRejection', (err) => c.logger.error({ err }, 'unhandledRejection'));

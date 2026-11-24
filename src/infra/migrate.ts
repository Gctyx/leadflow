import 'dotenv/config';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import mysql, { RowDataPacket } from 'mysql2/promise';

/**
 * Runner de migrations (SQL puro, somente "up"). Garante:
 *  - execução única via GET_LOCK (várias instâncias subindo juntas não colidem);
 *  - histórico em schema_migrations com checksum (migration já aplicada não pode ser editada).
 */
export async function migrate(
  databaseUrl: string,
  dir: string = path.resolve(__dirname, '../../migrations'),
  log: (msg: string) => void = console.log,
): Promise<string[]> {
  const conn = await mysql.createConnection({ uri: databaseUrl, multipleStatements: true });
  const applied: string[] = [];
  try {
    const [lockRows] = await conn.query<RowDataPacket[]>("SELECT GET_LOCK('leadflow_migrations', 60) AS ok");
    if (lockRows[0].ok !== 1) throw new Error('Não foi possível obter o lock de migrations');

    await conn.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version VARCHAR(100) NOT NULL PRIMARY KEY,
      checksum CHAR(64) NOT NULL,
      applied_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
    ) ENGINE=InnoDB`);

    const [rows] = await conn.query<RowDataPacket[]>('SELECT version, checksum FROM schema_migrations');
    const done = new Map<string, string>(rows.map((r) => [r.version as string, r.checksum as string]));

    const files = (await fs.readdir(dir)).filter((f) => /^\d+_.+\.sql$/.test(f)).sort();
    for (const file of files) {
      const sql = await fs.readFile(path.join(dir, file), 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');
      if (done.has(file)) {
        if (done.get(file) !== checksum) throw new Error(`Migration ${file} foi alterada depois de aplicada`);
        continue;
      }
      await conn.query(sql);
      await conn.query('INSERT INTO schema_migrations (version, checksum) VALUES (?, ?)', [file, checksum]);
      applied.push(file);
      log(`migration aplicada: ${file}`);
    }
    if (!applied.length) log('banco já está atualizado');
    return applied;
  } finally {
    await conn.query("SELECT RELEASE_LOCK('leadflow_migrations')").catch(() => undefined);
    await conn.end();
  }
}

if (require.main === module) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL não definida');
    process.exit(1);
  }
  migrate(url).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

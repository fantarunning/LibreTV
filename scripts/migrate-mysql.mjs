import { readFile } from 'node:fs/promises';
import mysql from 'mysql2/promise';

// Next's env loader keeps the CLI consistent with next start (.env.local / .env).
const { default: nextEnv } = await import('@next/env');
nextEnv.loadEnvConfig(process.cwd());
const connection = await mysql.createConnection(process.env.DATABASE_URL || {
  host: process.env.MYSQL_HOST,
  port: Number(process.env.MYSQL_PORT) || 3306,
  database: process.env.MYSQL_DATABASE,
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  multipleStatements: false,
});
try {
  for (const migration of ['001-accounts-sync.sql', '002-tv-commands.sql']) {
    const sql = await readFile(new URL(`../migrations/${migration}`, import.meta.url), 'utf8');
    for (const statement of sql.replace(/^--.*$/gm, '').split(';').map(s => s.trim()).filter(Boolean)) {
      await connection.query(statement);
    }
  }
  console.log('LibreTV account/sync migration completed.');
} finally {
  await connection.end();
}

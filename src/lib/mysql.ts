import mysql, { type Pool, type PoolConnection } from 'mysql2/promise';

export class AccountError extends Error {
  constructor(message: string, public status = 503) { super(message); }
}

let pool: Pool | undefined;

export function isDatabaseConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL || (
    process.env.MYSQL_HOST && process.env.MYSQL_DATABASE && process.env.MYSQL_USER
  ));
}

export function getMysqlPool(): Pool {
  if (pool) return pool;
  if (!isDatabaseConfigured()) throw new AccountError('MySQL 未配置，账号与云同步暂不可用');
  const limit = Math.min(10, Math.max(1, Number(process.env.MYSQL_CONNECTION_LIMIT) || 4));
  const common = {
    connectionLimit: limit,
    waitForConnections: true,
    queueLimit: 30,
    connectTimeout: 5000,
    enableKeepAlive: true,
    charset: 'utf8mb4',
    supportBigNumbers: true,
    bigNumberStrings: true,
    multipleStatements: false,
  };
  if (process.env.DATABASE_URL) {
    const url = new URL(process.env.DATABASE_URL);
    if (url.protocol !== 'mysql:' || !/^\/[\w-]+$/.test(url.pathname)) {
      throw new AccountError('DATABASE_URL 必须指定 MySQL 专用数据库');
    }
    pool = mysql.createPool({
      ...common, host: url.hostname, port: Number(url.port) || 3306,
      user: decodeURIComponent(url.username), password: decodeURIComponent(url.password),
      database: url.pathname.slice(1),
    });
  } else {
    pool = mysql.createPool({
      ...common, host: process.env.MYSQL_HOST, port: Number(process.env.MYSQL_PORT) || 3306,
      user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD || '',
      database: process.env.MYSQL_DATABASE,
    });
  }
  return pool;
}

export async function withTransaction<T>(fn: (connection: PoolConnection) => Promise<T>): Promise<T> {
  const connection = await getMysqlPool().getConnection();
  try {
    await connection.beginTransaction();
    const result = await fn(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

/** Never include driver errors, credentials or connection strings in an HTTP response. */
export function accountErrorResponse(error: unknown): Response {
  const status = error instanceof AccountError ? error.status : 503;
  const message = error instanceof AccountError ? error.message : 'MySQL 账号服务不可用，请检查数据库连接和迁移';
  return Response.json({ error: message }, { status, headers: { 'Cache-Control': 'no-store' } });
}

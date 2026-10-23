import type { RowDataPacket } from 'mysql2/promise';
import type { AccountSession } from './cloud-types';
import { credentialEpoch } from './auth';
import { AccountError, getMysqlPool, withTransaction } from './mysql';

export type TvAction = 'play' | 'pause' | 'resume' | 'seek';
export function validateTvCommand(body: Record<string, unknown>) {
  if (Object.keys(body).some(key => !['deviceId', 'action', 'payload'].includes(key))) throw new AccountError('遥控请求含未知字段', 400);
  if (typeof body.deviceId !== 'string' || !/^[a-f0-9-]{36}$/.test(body.deviceId)) throw new AccountError('电视设备 ID 无效', 400);
  if (!['play', 'pause', 'resume', 'seek'].includes(String(body.action))) throw new AccountError('不支持的遥控操作', 400);
  const action = body.action as TvAction;
  if (action === 'pause' || action === 'resume') return { deviceId: body.deviceId, action, payload: null };
  if (!body.payload || typeof body.payload !== 'object' || Array.isArray(body.payload)) throw new AccountError('缺少遥控参数', 400);
  const payload = body.payload as Record<string, unknown>;
  if (action === 'seek') {
    if (typeof payload.position !== 'number' || !Number.isFinite(payload.position) || payload.position < 0 || payload.position > 7 * 86400) throw new AccountError('播放进度无效', 400);
    return { deviceId: body.deviceId, action, payload: { position: payload.position } };
  }
  if (!payload.source || typeof payload.source !== 'object' || Array.isArray(payload.source)) throw new AccountError('播放源无效', 400);
  const source = payload.source as Record<string, unknown>;
  if (typeof source.url !== 'string' || source.url.length > 4096 || typeof source.key !== 'string' || !source.key || source.key.length > 200 || typeof source.name !== 'string' || source.name.length > 200) throw new AccountError('播放源无效', 400);
  try { if (!['http:', 'https:'].includes(new URL(source.url).protocol)) throw new Error(); }
  catch { throw new AccountError('播放源必须为 HTTP 地址', 400); }
  if (typeof payload.vodId !== 'string' || !payload.vodId || payload.vodId.length > 512 || typeof payload.title !== 'string' || payload.title.length > 300 || !Number.isInteger(payload.episodeIndex) || Number(payload.episodeIndex) < 0 || Number(payload.episodeIndex) > 10000) throw new AccountError('影片或集号无效', 400);
  if (payload.position !== undefined && (typeof payload.position !== 'number' || !Number.isFinite(payload.position) || payload.position < 0 || payload.position > 7 * 86400)) throw new AccountError('播放进度无效', 400);
  let direct: { directUrl?: string; width?: number; height?: number; codec?: string; isLive?: boolean } = {};
  if (payload.directUrl !== undefined) {
    if (typeof payload.directUrl !== 'string' || payload.directUrl.length > 4096) throw new AccountError('直链地址无效', 400);
    try { if (!['http:', 'https:'].includes(new URL(payload.directUrl).protocol)) throw new Error(); }
    catch { throw new AccountError('直链必须为 HTTP 地址', 400); }
    for (const dimension of ['width', 'height'] as const) {
      if (payload[dimension] !== undefined && (!Number.isInteger(payload[dimension]) || Number(payload[dimension]) < 1 || Number(payload[dimension]) > 16384)) throw new AccountError('视频尺寸无效', 400);
    }
    if (payload.codec !== undefined && (typeof payload.codec !== 'string' || payload.codec.length > 100)) throw new AccountError('视频编码无效', 400);
    if (payload.isLive !== undefined && typeof payload.isLive !== 'boolean') throw new AccountError('直播类型无效', 400);
    direct = { directUrl: payload.directUrl, width: payload.width as number | undefined, height: payload.height as number | undefined, codec: payload.codec as string | undefined, isLive: payload.isLive as boolean | undefined };
  }
  return { deviceId: body.deviceId, action, payload: {
    source: { key: source.key, name: source.name, url: source.url }, vodId: payload.vodId,
    title: payload.title, episodeIndex: payload.episodeIndex, position: payload.position ?? 0, ...direct,
  } };
}

export async function sendTvCommand(session: AccountSession, command: ReturnType<typeof validateTvCommand>) {
  if (session.device.type !== 'web') throw new AccountError('请通过手机或平板遥控电视', 403);
  return withTransaction(async connection => {
    const [devices] = await connection.execute<RowDataPacket[]>(
      `SELECT id FROM ltv_devices WHERE id=? AND user_id=? AND device_type='tv'
       AND revoked_at IS NULL AND expires_at>? AND credential_epoch=? FOR UPDATE`,
      [command.deviceId, session.user.id, Date.now(), credentialEpoch()]);
    if (!devices.length) throw new AccountError('电视设备不存在或已退出登录', 404);
    await connection.execute('DELETE FROM ltv_tv_commands WHERE expires_at<?', [Date.now()]);
    const [counts] = await connection.execute<(RowDataPacket & { total: string })[]>(
      'SELECT COUNT(*) AS total FROM ltv_tv_commands WHERE device_id=?', [command.deviceId]);
    const overflow = Number(counts[0].total) - 49;
    if (overflow > 0) await connection.query('DELETE FROM ltv_tv_commands WHERE device_id=? ORDER BY id LIMIT ?', [command.deviceId, overflow]);
    await connection.execute('INSERT INTO ltv_tv_commands (user_id,device_id,action,payload,expires_at) VALUES (?,?,?,?,?)',
      [session.user.id, command.deviceId, command.action, command.payload === null ? null : JSON.stringify(command.payload), Date.now() + 120000]);
    return { success: true };
  });
}

export async function pullTvCommands(session: AccountSession, after: number) {
  if (session.device.type !== 'tv') throw new AccountError('此接口仅限已配对电视', 403);
  const [rows] = await getMysqlPool().execute<(RowDataPacket & { id: string; action: TvAction; payload: unknown })[]>(
    `SELECT id,action,payload FROM ltv_tv_commands WHERE user_id=? AND device_id=? AND id>? AND expires_at>? ORDER BY id LIMIT 50`,
    [session.user.id, session.device.id, after, Date.now()]);
  const commands = rows.map(row => ({ id: Number(row.id), action: row.action, payload: row.payload }));
  return { commands, cursor: commands.at(-1)?.id ?? after };
}

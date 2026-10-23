/** Shared wire contract for browser, Android TV and the MySQL sync service. */
export type CloudKind = 'history' | 'progress' | 'skip' | 'favorite' | 'preferences';

export interface CloudRecord {
  kind: CloudKind;
  key: string;
  value: unknown | null;
  version: number;
  updatedAt: number;
}

export interface CloudMutation {
  eventId: string;
  kind: CloudKind;
  key: string;
  value: unknown | null;
  baseVersion: number;
}

export interface CloudPullResponse {
  records: CloudRecord[];
  cursor: number;
  hasMore: boolean;
}

export interface CloudPushResponse {
  accepted: string[];
  records: CloudRecord[];
  conflicts: CloudRecord[];
}

export interface AccountSession {
  user: { id: string; name: string };
  device: { id: string; name: string; type: 'web' | 'tv'; expiresAt: number };
  syncEnabled: boolean;
}

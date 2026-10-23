'use client';

import Link from 'next/link';
import { useState, useSyncExternalStore } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Header } from '@/components/header';
import { useAuth } from '@/components/auth';
import { useToast } from '@/components/toast';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { api } from '@/lib/client-api';
import { getSyncState, subscribeSync, syncNow, type SyncState } from '@/lib/cloud-sync';

const INITIAL_SYNC: SyncState = { status: 'idle' };
const LABELS = { idle: '等待登录', syncing: '正在同步', synced: '已同步到云端', offline: '离线，记录已保存在本地', error: '同步暂不可用' };

export default function AccountPage() {
  const { account, verified, checked, openLogin, logout } = useAuth();
  const sync = useSyncExternalStore(subscribeSync, getSyncState, () => INITIAL_SYNC);
  const { toast } = useToast();
  const cache = useQueryClient();
  const [revoke, setRevoke] = useState<{ id: string; name: string } | null>(null);
  const devices = useQuery({ queryKey: ['account-devices', account?.user.id], queryFn: () => api.devices(), enabled: verified });
  return (
    <div className="min-h-screen">
      <Header />
      <main className="max-w-2xl mx-auto px-4 py-10">
        <h1 className="text-2xl font-semibold mb-2">我的账号</h1>
        <p className="text-sm text-muted mb-8">手机、平板和电视，接着上一次观看。</p>
        {!checked ? <p className="text-muted">正在读取账号…</p> : !verified ? (
          <div className="py-8"><p className="text-muted mb-4">登录后查看云历史和已绑定设备。</p><button className="btn-primary" onClick={openLogin}>登录</button></div>
        ) : <>
          <section className="border-b border-line pb-7 mb-7">
            <div className="flex items-start justify-between gap-4">
              <div><h2 className="font-medium">{account?.user.name ?? '家庭账号'}</h2><p className="text-sm text-muted mt-2">此设备登录至 {account ? new Date(account.device.expiresAt).toLocaleDateString('zh-CN') : '—'}</p></div>
              <button className="btn-ghost text-sm" onClick={() => void logout()}>退出登录</button>
            </div>
            <div className="mt-6 flex items-center justify-between gap-4">
              <div aria-live="polite"><p className="text-sm">{LABELS[sync.status]}</p><p className="text-xs text-faint mt-1">{sync.message ?? (sync.lastSyncedAt ? `最近同步 ${new Date(sync.lastSyncedAt).toLocaleTimeString('zh-CN')}` : '观看进度、历史和跳过标记自动同步')}</p></div>
              <button className="btn-ghost text-sm shrink-0" disabled={sync.status === 'syncing'} onClick={() => void syncNow()}>立即同步</button>
            </div>
          </section>
          <section className="mb-8">
            <div className="flex items-center justify-between gap-4 mb-5"><h2 className="font-medium">我的设备</h2><Link className="btn-primary text-sm" href="/account/tv">绑定电视</Link></div>
            <p className="text-sm text-muted mb-4">手机和平板保持登录 30 天，电视授权 365 天。可以随时解除设备授权。</p>
            {devices.isPending ? <p className="text-sm text-faint">正在读取设备…</p> : devices.isError ? <button className="btn-ghost" onClick={() => void devices.refetch()}>设备加载失败，点击重试</button> : (
              <ul className="divide-y divide-line">
                {devices.data?.devices.map((device) => <li key={device.id} className="py-4 flex items-center justify-between gap-4">
                  <div className="min-w-0"><p className="text-sm truncate">{device.name}{device.current ? ' · 当前设备' : ''}</p><p className="text-xs text-faint mt-1">{device.type === 'tv' ? '电视' : '手机 / 平板 / 浏览器'} · {new Date(device.expiresAt).toLocaleDateString('zh-CN')} 到期</p></div>
                  <button className="btn-ghost text-sm shrink-0" onClick={() => setRevoke({ id: device.id, name: device.name })}>解除</button>
                </li>)}
              </ul>
            )}
          </section>
          <Link href="/downloads/libretv-tv.apk" className="text-sm text-accent underline underline-offset-4">下载电视安装包</Link>
        </>}
      </main>
      <ConfirmDialog open={Boolean(revoke)} title="解除设备授权？" message={`「${revoke?.name ?? ''}」将需要重新登录。`} confirmLabel="解除授权" danger onCancel={() => setRevoke(null)} onConfirm={() => {
        if (!revoke) return;
        const id = revoke.id;
        setRevoke(null);
        void api.revokeDevice(id).then(async () => { toast('设备授权已解除', 'success'); await cache.invalidateQueries({ queryKey: ['account-devices'] }); if (id === account?.device.id) await logout(); }).catch((error: Error) => toast(error.message, 'error'));
      }} />
    </div>
  );
}

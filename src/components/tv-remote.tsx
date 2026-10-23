'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { Drawer } from './drawer';
import { useToast } from './toast';
import { api } from '@/lib/client-api';
import type { SourceConfig } from '@/lib/types';

export function TvRemote({ source, vodId, title, episodeIndex, getPosition, direct }: {
  source: SourceConfig;
  vodId: string;
  title: string;
  episodeIndex: number;
  getPosition: () => number;
  direct?: { directUrl: string; width?: number; height?: number; codec?: string; isLive?: boolean };
}) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState('');
  const [busy, setBusy] = useState(false);
  const { toast } = useToast();
  const query = useQuery({ queryKey: ['tv-remote-devices'], queryFn: () => api.devices(), enabled: open, staleTime: 0 });
  const televisions = query.data?.devices.filter((device) => device.type === 'tv') ?? [];
  const target = selected || televisions[0]?.id || '';
  const send = async (action: 'play' | 'pause' | 'resume' | 'seek') => {
    if (!target) return;
    setBusy(true);
    try {
      await api.tvCommand(target, action, action === 'play' ? { source, vodId, title, episodeIndex, position: getPosition(), ...direct } : action === 'seek' ? { position: getPosition() } : undefined);
      toast(action === 'play' ? '已发送到电视，请保持电视应用打开' : '控制指令已发送', 'success');
    } catch (error) { toast(error instanceof Error ? error.message : '发送失败', 'error'); }
    finally { setBusy(false); }
  };
  return <>
    <button className="btn-ghost btn-sm" onClick={() => setOpen(true)}>电视播放</button>
    <Drawer open={open} onClose={() => setOpen(false)} title="在电视上播放" width="max-w-md">
      <p className="text-sm text-muted mb-5">打开电视上的 LibreTV，发送当前影片和播放位置。电视独立播放，你可以在这里暂停或继续。</p>
      {query.isPending ? <p className="text-sm text-faint">正在读取电视…</p> : query.isError ? <button className="btn-ghost" onClick={() => void query.refetch()}>读取失败，点击重试</button> : televisions.length === 0 ? <Link className="btn-primary" href="/account/tv">先绑定电视</Link> : <>
        <label className="block text-sm mb-2" htmlFor="remote-tv">选择电视</label>
        <select id="remote-tv" className="input w-full mb-5" value={target} onChange={(event) => setSelected(event.target.value)}>
          {televisions.map((device) => <option key={device.id} value={device.id}>{device.name}</option>)}
        </select>
        <button className="btn-primary w-full mb-4" disabled={busy} onClick={() => void send('play')}>从当前位置在电视播放</button>
        <div className="flex flex-wrap gap-2">
          <button className="btn-ghost" disabled={busy} onClick={() => void send('pause')}>暂停</button>
          <button className="btn-ghost" disabled={busy} onClick={() => void send('resume')}>继续播放</button>
          <button className="btn-ghost" disabled={busy} onClick={() => void send('seek')}>同步到手机当前进度</button>
        </div>
      </>}
    </Drawer>
  </>;
}

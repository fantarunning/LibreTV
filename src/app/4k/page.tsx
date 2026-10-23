'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Header } from '@/components/header';
import { SiteFooter } from '@/components/site-footer';
import { SmartImage } from '@/components/smart-image';
import { useAuth } from '@/components/auth';
import { useAppStore } from '@/lib/store';
import { fourKWatchUrl, type FourKItem } from '@/lib/fourk';

export default function FourKPage() {
  const { verified, openLogin } = useAuth();
  const imageMode = useAppStore((state) => state.imageProxyMode);
  const customProxy = useAppStore((state) => state.customImageProxy);
  const query = useQuery({
    queryKey: ['verified-4k-library'],
    queryFn: async ({ signal }) => {
      const response = await fetch('/sources/4k.json', { signal, cache: 'no-cache' });
      if (!response.ok) throw new Error('4K片库暂不可用');
      return await response.json() as { updatedAt: string; items: FourKItem[] };
    },
    staleTime: 5 * 60_000,
  });
  const entries = query.data?.items ?? [];
  return <div className="min-h-screen flex flex-col"><Header /><main className="max-w-4xl mx-auto w-full flex-1 px-4 py-10">
    <div className="flex items-start justify-between gap-4 mb-8"><div><h1 className="text-2xl font-semibold mb-3">4K专区</h1><p className="text-sm text-muted leading-relaxed">按实际视频尺寸核实，展示完整分辨率。宽银幕影片可能采用裁切画幅。</p></div><Link className="btn-ghost text-sm shrink-0" href="/">返回首页</Link></div>
    {query.isPending ? <p className="text-sm text-muted py-8">正在获取4K片库…</p> : query.isError ? <div className="py-8"><p className="text-muted mb-4">4K片库暂不可用，请稍后重试。</p><button className="btn-primary" onClick={() => void query.refetch()}>重新加载</button></div> : entries.length === 0 ? <p className="text-muted py-8">暂时没有已核实的4K资源，请稍后重试。</p> : <>
      {(['vod', 'live'] as const).map((kind) => {
        const items = entries.filter((item) => item.kind === kind);
        if (!items.length) return null;
        return <section key={kind} className="mb-10"><h2 className="font-medium mb-3">{kind === 'vod' ? '4K点播' : '4K直播'}</h2><ul className="divide-y divide-line">
          {items.map((item) => <li key={item.id} className="py-5 flex items-center gap-4">
            {item.cover && <div className="shrink-0 w-12 h-[72px] bg-chip rounded-md overflow-hidden"><SmartImage url={item.cover} alt="" mode={imageMode} customProxy={customProxy} className="w-full h-full object-cover" /></div>}
            <div className="min-w-0 flex-1"><h3 className="font-medium text-sm sm:text-base break-words">{item.title}</h3><p className="text-accent text-sm mt-1.5 tabular-nums">{item.width} × {item.height}{item.codec ? ` · ${item.codec.toUpperCase()}` : ''}</p><p className="text-xs text-faint mt-1.5">{item.provider} · {new Date(item.verifiedAt).toLocaleDateString('zh-CN')} 核实</p></div>
            <Link className="btn-primary text-sm shrink-0" href={fourKWatchUrl(item)} onClick={(event) => { if (!verified) { event.preventDefault(); openLogin(); } }}>{kind === 'live' ? '看直播' : '播放'}</Link>
          </li>)}
        </ul></section>;
      })}
      <p className="text-xs text-faint leading-relaxed">片源和网络状态可能变化。实际播放效果还取决于设备解码能力；支持换源及播放失败重试。</p>
    </>}
  </main><SiteFooter /></div>;
}

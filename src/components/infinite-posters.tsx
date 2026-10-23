'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useWindowVirtualizer } from '@tanstack/react-virtual';
import type { DoubanItem } from '@/lib/types';
import { DoubanCard } from './video-card';

/** Virtualize complete rows so long browsing does not retain thousands of image elements. */
export function InfinitePosters({ items, onPick, loadMore, hasMore, fetching, error }: {
  items: DoubanItem[];
  onPick: (title: string) => void;
  loadMore: () => void;
  hasMore: boolean;
  fetching: boolean;
  error: boolean;
}) {
  const container = useRef<HTMLDivElement>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState({ columns: 3, rowHeight: 220, offset: 0 });
  useLayoutEffect(() => {
    const measure = () => {
      if (!container.current) return;
      const width = container.current.clientWidth;
      const viewport = window.innerWidth;
      const columns = viewport >= 1024 ? 8 : viewport >= 768 ? 6 : viewport >= 640 ? 4 : 3;
      const rowHeight = Math.ceil(((width - (columns - 1) * 10) / columns) * 1.5 + 54);
      setLayout({ columns, rowHeight, offset: container.current.getBoundingClientRect().top + window.scrollY });
    };
    measure();
    const observer = new ResizeObserver(measure);
    if (container.current) observer.observe(container.current);
    window.addEventListener('resize', measure);
    return () => { observer.disconnect(); window.removeEventListener('resize', measure); };
  }, []);
  const rows = Math.ceil(items.length / layout.columns);
  const virtualizer = useWindowVirtualizer({
    count: rows,
    estimateSize: () => layout.rowHeight,
    scrollMargin: layout.offset,
    overscan: 3,
  });
  useEffect(() => { virtualizer.measure(); }, [layout.rowHeight, layout.columns, virtualizer]);
  useEffect(() => {
    const target = sentinel.current;
    if (!target || !hasMore || fetching || error || !('IntersectionObserver' in window)) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) loadMore();
    }, { rootMargin: '700px' });
    observer.observe(target);
    return () => observer.disconnect();
  }, [hasMore, fetching, error, loadMore]);

  return (
    <div ref={container}>
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
        {virtualizer.getVirtualItems().map((row) => (
          <div key={row.key} className="grid gap-2.5 absolute left-0 top-0 w-full"
            style={{ gridTemplateColumns: `repeat(${layout.columns}, minmax(0, 1fr))`, transform: `translateY(${row.start - layout.offset}px)`, minHeight: layout.rowHeight }}>
            {items.slice(row.index * layout.columns, (row.index + 1) * layout.columns).map((item) => (
              <DoubanCard key={item.id} item={item} onClick={() => onPick(item.title)} />
            ))}
          </div>
        ))}
      </div>
      <div ref={sentinel} className="flex min-h-20 items-center justify-center" aria-live="polite">
        {hasMore ? (
          <button className="btn-ghost text-sm" disabled={fetching} onClick={loadMore}>
            {fetching ? '正在发现更多影片…' : error ? '加载失败，点击重试' : '加载更多'}
          </button>
        ) : <span className="text-xs text-faint">已看完这个分类，换个分类继续发现</span>}
      </div>
    </div>
  );
}

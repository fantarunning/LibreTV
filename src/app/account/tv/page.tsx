'use client';

import Link from 'next/link';
import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Header } from '@/components/header';
import { useAuth } from '@/components/auth';
import { api } from '@/lib/client-api';

export default function PairTvPage() {
  return <Suspense><PairTv /></Suspense>;
}

function PairTv() {
  const params = useSearchParams();
  const { verified, checked, openLogin } = useAuth();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { setCode((params.get('code') ?? '').toUpperCase().slice(0, 16)); }, [params]);
  return (
    <div className="min-h-screen"><Header /><main className="max-w-md mx-auto px-5 py-12">
      <h1 className="text-2xl font-semibold mb-3">在电视上接着看</h1>
      {done ? <div role="status" className="mt-8"><h2 className="text-lg font-medium mb-3">电视已授权</h2><p className="text-sm text-muted leading-relaxed">回到电视即可开始观看，历史记录会自动同步。电视将保持登录 365 天。</p><Link className="btn-primary inline-flex mt-6" href="/account">查看我的设备</Link></div> : <>
        <p className="text-sm text-muted leading-relaxed mb-8">打开电视上的 LibreTV，输入屏幕上的配对码。确认后，电视将登录你的账号并共享观看记录。</p>
        {!checked ? <p className="text-muted">正在检查登录状态…</p> : !verified ? <button className="btn-primary" onClick={openLogin}>先登录账号</button> : <form onSubmit={(event) => {
          event.preventDefault(); setBusy(true); setError('');
          void api.approveTv(code.trim()).then(() => setDone(true)).catch((reason: Error) => setError(reason.message)).finally(() => setBusy(false));
        }}>
          <label className="block text-sm mb-2" htmlFor="tv-code">电视配对码</label>
          <input id="tv-code" className="input w-full text-center text-2xl tracking-[0.2em] h-14" value={code} maxLength={16} autoComplete="one-time-code" autoCapitalize="characters" spellCheck={false} onChange={(event) => setCode(event.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, ''))} placeholder="输入配对码" required />
          {error && <p role="alert" className="text-sm text-danger mt-3">{error}</p>}
          <button className="btn-primary w-full mt-5" disabled={busy || code.length < 4}>{busy ? '正在授权…' : '确认授权这台电视'}</button>
          <p className="text-xs text-faint leading-relaxed mt-4">请核对电视上的配对码。你可以在“我的账号”中随时解除授权。</p>
        </form>}
      </>}
    </main></div>
  );
}

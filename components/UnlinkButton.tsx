'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

export function UnlinkButton() {
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function unlink() {
    setError(null);
    try {
      const res = await fetch('/api/discord/unlink', { method: 'POST' });
      if (!res.ok) throw new Error(String(res.status));
      startTransition(() => router.refresh());
      setConfirming(false);
    } catch {
      setError('Odpojenie sa nepodarilo. Skús to znova.');
    }
  }

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="text-sm text-neutral-500 underline-offset-2 hover:text-neutral-300 hover:underline"
      >
        Odpojiť Discord
      </button>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-sm text-neutral-300">
        Odpojením stratíš rolu <strong>Předplatné</strong> na serveri. Pokračovať?
      </p>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={unlink}
          disabled={pending}
          className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white
                     hover:bg-red-500 disabled:opacity-50"
        >
          {pending ? 'Odpájam…' : 'Áno, odpojiť'}
        </button>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          className="rounded-lg border border-white/15 px-3 py-1.5 text-sm text-neutral-300
                     hover:bg-white/5"
        >
          Zrušiť
        </button>
      </div>
      {error && <p className="text-sm text-red-400">{error}</p>}
    </div>
  );
}

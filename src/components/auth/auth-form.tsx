'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { api } from '@/lib/client/api';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/misc';
import { Logo } from '@/components/layout/sidebar';

export function AuthForm({ mode }: { mode: 'login' | 'signup' }) {
  const sp = useSearchParams();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (mode === 'signup' && password.length < 8) return setError('Use at least 8 characters for your password.');
    setBusy(true);
    try {
      await api(`/api/auth/${mode}`, { body: mode === 'signup' ? { email, name, password } : { email, password } });
      const next = sp.get('next');
      location.href = next && next.startsWith('/') && !next.startsWith('//') ? next : mode === 'signup' ? '/setup' : '/';
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };
  return (
    <div className="animate-rise sm:rounded-[20px] sm:border sm:border-line sm:bg-surface sm:p-8">
      <div className="mb-8">
        <div className="flex items-center gap-2.5">
          <Logo className="size-9" />
          <span className="font-display text-xl font-extrabold">Aurora</span>
        </div>
        <h1 className="mt-10 font-display text-[34px] font-extrabold leading-[1.02]">{mode === 'login' ? 'Welcome back' : 'Create your account'}</h1>
        <p className="mt-2 text-sm text-fg-2">{mode === 'login' ? 'Sign in to keep listening.' : 'Your music, your library, your sound.'}</p>
      </div>
      <form onSubmit={submit} className="space-y-4" noValidate>
        {mode === 'signup' && (
          <div>
            <Label htmlFor="name">Name</Label>
            <Input id="name" autoComplete="name" required value={name} onChange={(e) => setName(e.target.value)} placeholder="What should we call you?" />
          </div>
        )}
        <div>
          <Label htmlFor="email">Email</Label>
          <Input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
        </div>
        <div>
          <Label htmlFor="password" hint={mode === 'signup' ? 'at least 8 characters' : undefined}>Password</Label>
          <Input id="password" type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} required value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
        </div>
        {error && (
          <p role="alert" className="rounded-lg bg-danger/12 px-3 py-2 text-sm text-danger">
            {error}
          </p>
        )}
        <Button type="submit" variant="primary" size="lg" className="h-[52px] w-full text-[16px]" loading={busy}>
          {mode === 'login' ? 'Sign in' : 'Create account'}
        </Button>
      </form>
      <p className="mt-6 text-center text-sm text-fg-2">
        {mode === 'login' ? (
          <>
            New here?{' '}
            <Link href="/signup" className="font-semibold text-fg hover:underline">
              Create an account
            </Link>
          </>
        ) : (
          <>
            Already have an account?{' '}
            <Link href="/login" className="font-semibold text-fg hover:underline">
              Sign in
            </Link>
          </>
        )}
      </p>
    </div>
  );
}

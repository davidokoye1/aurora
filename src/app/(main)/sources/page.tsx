'use client';

import { Suspense } from 'react';
import { SourcesView } from '@/components/sources/sources-view';

export default function SourcesPage() {
  return (
    <Suspense>
      <SourcesView />
    </Suspense>
  );
}

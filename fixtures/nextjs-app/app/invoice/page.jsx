'use client';
import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';

function Invoice() {
  const searchParams = useSearchParams();
  return <h1>Invoice {searchParams.get('invoiceId')}</h1>;
}

// Needs ?invoiceId=…; with no record ID set, QAgent reports it unverified
export default function InvoicePage() {
  return (
    <Suspense>
      <Invoice />
    </Suspense>
  );
}

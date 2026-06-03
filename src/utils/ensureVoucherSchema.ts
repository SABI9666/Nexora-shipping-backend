import prisma from '../config/database';

// Targeted, idempotent schema sync for the supplier-payment feature.
//
// `prisma db push` runs at deploy time but has been observed to fail
// transiently when the Postgres pool is still cold at boot, leaving the
// server running against an out-of-date schema. The Prisma client then
// returns P2022 ("column does not exist") for every voucher / report
// query.
//
// This function applies the one column the supplier-payment feature
// needs via raw SQL with `IF NOT EXISTS`, so it is safe to run on every
// process start. It runs *after* the server is already listening (called
// from the post-listen bootstrap section in app.ts), by which point the
// Postgres connection pool has usually recovered, and it retries a few
// times with backoff just in case.
export async function ensureVoucherAllocationSchema(): Promise<void> {
  const statements: { name: string; sql: string }[] = [
    {
      name: 'voucher_allocations.purchaseVoucherId column',
      sql: `ALTER TABLE "voucher_allocations" ADD COLUMN IF NOT EXISTS "purchaseVoucherId" TEXT`,
    },
    {
      name: 'voucher_allocations.purchaseVoucherId index',
      sql: `CREATE INDEX IF NOT EXISTS "voucher_allocations_purchaseVoucherId_idx" ON "voucher_allocations"("purchaseVoucherId")`,
    },
    {
      name: 'voucher_allocations.purchaseVoucherId FK',
      // Wrap the FK add in a DO block so the constraint is only added when
      // missing — Postgres has no native "ADD CONSTRAINT IF NOT EXISTS".
      sql: `DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint
            WHERE conname = 'voucher_allocations_purchaseVoucherId_fkey'
          ) THEN
            ALTER TABLE "voucher_allocations"
              ADD CONSTRAINT "voucher_allocations_purchaseVoucherId_fkey"
              FOREIGN KEY ("purchaseVoucherId") REFERENCES "vouchers"("id")
              ON DELETE SET NULL ON UPDATE CASCADE;
          END IF;
        END $$`,
    },
  ];

  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      for (const stmt of statements) {
        await prisma.$executeRawUnsafe(stmt.sql);
      }
      console.log(`[schema] voucher_allocations.purchaseVoucherId verified on attempt ${attempt}`);
      return;
    } catch (err) {
      const msg = (err as { message?: string }).message || String(err);
      console.warn(`[schema] attempt ${attempt} failed: ${msg.split('\n')[0]}`);
      if (attempt === 5) {
        console.error('[schema] giving up — supplier-payment queries will 500 until DB is reachable');
        return;
      }
      await new Promise((r) => setTimeout(r, attempt * 5000));
    }
  }
}

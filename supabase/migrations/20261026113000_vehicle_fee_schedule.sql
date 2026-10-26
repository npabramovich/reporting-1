-- A vehicle's dated management fee schedule (lib/accounting/fee-schedule.ts, the fund engine's
-- feeSchedule): { frequency, start, end, steps: [{ from, rate, basis }], organizationalExpenseCap? }.
-- The management fee allocation charges it for the period a date falls in. Null: no schedule, and
-- the fee is booked from a rate as before.
--
-- ADDITIVE AND SAFE BEFORE DEPLOY. A nullable column the live release neither reads nor writes.

alter table public.vehicle_accounting_settings
  add column if not exists fee_schedule jsonb
    check (fee_schedule is null or jsonb_typeof(fee_schedule) = 'object');

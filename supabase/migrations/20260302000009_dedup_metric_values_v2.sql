-- Clean up duplicate metric_values that slipped through.
-- Keep the most recent row per (metric_id, period_year, period_quarter, period_month).
-- Uses COALESCE to handle NULLs consistently with the unique index.

DELETE FROM metric_values
WHERE id NOT IN (
  SELECT DISTINCT ON (
    metric_id,
    period_year,
    COALESCE(period_quarter, 0),
    COALESCE(period_month, 0)
  ) id
  FROM metric_values
  ORDER BY metric_id, period_year, COALESCE(period_quarter, 0), COALESCE(period_month, 0), created_at DESC
);

-- Ensure the unique index exists (idempotent)
CREATE UNIQUE INDEX IF NOT EXISTS metric_values_unique_period
ON metric_values (metric_id, period_year, COALESCE(period_quarter, 0), COALESCE(period_month, 0));

-- Drop the older index if it exists (same columns, potentially different name)
DROP INDEX IF EXISTS metric_values_period_idx;

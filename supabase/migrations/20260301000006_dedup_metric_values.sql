-- Delete duplicate metric_values, keeping the most recently created row per period
DELETE FROM metric_values
WHERE id NOT IN (
  SELECT DISTINCT ON (metric_id, period_year, period_quarter, period_month) id
  FROM metric_values
  ORDER BY metric_id, period_year, period_quarter, period_month, created_at DESC
);

-- Add unique index to prevent future duplicates
CREATE UNIQUE INDEX IF NOT EXISTS metric_values_unique_period
ON metric_values (metric_id, period_year, COALESCE(period_quarter, 0), COALESCE(period_month, 0));

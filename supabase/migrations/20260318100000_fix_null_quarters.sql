-- Fix metric_values rows where period_quarter is null but can be derived from month.
UPDATE metric_values
SET period_quarter = CEIL(period_month::numeric / 3)
WHERE period_quarter IS NULL
  AND period_month IS NOT NULL;

-- Fix annual/year-end values that have no month and no quarter.
-- These represent full-year figures — store as month 12, quarter 4.
UPDATE metric_values
SET period_quarter = 4,
    period_month = 12,
    period_label = CASE
      WHEN period_label LIKE 'FY %' AND period_label NOT LIKE '%ending%' THEN 'Year End ' || period_year
      WHEN period_label LIKE 'YE %' THEN 'Year End ' || period_year
      ELSE period_label
    END
WHERE period_quarter IS NULL
  AND period_month IS NULL;

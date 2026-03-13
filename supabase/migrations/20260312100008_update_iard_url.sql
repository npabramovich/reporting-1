-- Update IARD filing portal URL to new FINRA CRD URL
update compliance_items
set filing_portal_url = 'https://crd.finra.org/Iad/', updated_at = now()
where filing_portal_url = 'https://www.iard.com/';

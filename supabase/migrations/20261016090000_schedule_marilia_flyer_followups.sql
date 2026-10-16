-- Preserve the existing Tue/Fri 09:00 BRT primary run.
-- pg_cron follows UTC: 11h, 14h and 17h BRT => 14:00, 17:00, 20:00 UTC.
-- Follow-ups only download/analyze new or incomplete sources; the collector
-- checks registered source hashes and resumes at most two stale valid jobs.
select cron.schedule(
  'collect-marilia-flyers-tue-fri-followups',
  '0 14,17,20 * * 2,5',
  $command$
    select net.http_post(
      url := 'https://hwpsnipdkwxvvjowomlo.supabase.co/functions/v1/collect-marilia-flyers',
      headers := '{"Content-Type":"application/json"}'::jsonb,
      body := jsonb_build_object('scheduled_at',now(),'recheck',true),
      timeout_milliseconds := 150000
    );
  $command$
);

-- The following morning catches late publications and retries recoverable
-- jobs while the offers may still be valid. 09:00 BRT => 12:00 UTC.
select cron.schedule(
  'collect-marilia-flyers-wed-sat-0900-recheck',
  '0 12 * * 3,6',
  $command$
    select net.http_post(
      url := 'https://hwpsnipdkwxvvjowomlo.supabase.co/functions/v1/collect-marilia-flyers',
      headers := '{"Content-Type":"application/json"}'::jsonb,
      body := jsonb_build_object('scheduled_at',now(),'recheck',true),
      timeout_milliseconds := 150000
    );
  $command$
);

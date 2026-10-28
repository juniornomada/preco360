-- Make 09:00 BRT the readiness deadline for Marília flyer data.
-- pg_cron runs in UTC, so schedules below are shifted by +3h.

-- 21:00 BRT on Monday/Thursday = 00:00 UTC on Tuesday/Friday.
select cron.schedule(
  'collect-marilia-flyers-mon-thu-2100-preflight',
  '0 0 * * 2,5',
  $command$
    select net.http_post(
      url := 'https://hwpsnipdkwxvvjowomlo.supabase.co/functions/v1/collect-marilia-flyers',
      headers := '{"Content-Type":"application/json"}'::jsonb,
      body := jsonb_build_object('scheduled_at',now(),'preflight',true,'recheck',true),
      timeout_milliseconds := 150000
    );
  $command$
);

-- Full discovery at 06:00, 07:00 and 08:00 BRT.
select cron.schedule(
  'collect-marilia-flyers-tue-fri-preflight-hourly',
  '0 9-11 * * 2,5',
  $command$
    select net.http_post(
      url := 'https://hwpsnipdkwxvvjowomlo.supabase.co/functions/v1/collect-marilia-flyers',
      headers := '{"Content-Type":"application/json"}'::jsonb,
      body := jsonb_build_object('scheduled_at',now(),'preflight',true,'recheck',true),
      timeout_milliseconds := 150000
    );
  $command$
);

-- Final source discovery at 08:30 and 08:50 BRT.
select cron.schedule(
  'collect-marilia-flyers-tue-fri-preflight-late',
  '30,50 11 * * 2,5',
  $command$
    select net.http_post(
      url := 'https://hwpsnipdkwxvvjowomlo.supabase.co/functions/v1/collect-marilia-flyers',
      headers := '{"Content-Type":"application/json"}'::jsonb,
      body := jsonb_build_object('scheduled_at',now(),'preflight',true,'recheck',true),
      timeout_milliseconds := 150000
    );
  $command$
);

-- Lightweight recovery-only checks every 10 minutes from 06:05 through 08:55 BRT.
select cron.schedule(
  'recover-marilia-flyers-tue-fri-preflight',
  '5-55/10 9-11 * * 2,5',
  $command$
    select net.http_post(
      url := 'https://hwpsnipdkwxvvjowomlo.supabase.co/functions/v1/collect-marilia-flyers',
      headers := '{"Content-Type":"application/json"}'::jsonb,
      body := jsonb_build_object('scheduled_at',now(),'recover_only',true),
      timeout_milliseconds := 30000
    );
  $command$
);

-- Keep the 09:00 BRT run as a final discovery plus recovery pass.
select cron.alter_job(
  job_id := (select jobid from cron.job where jobname = 'collect-marilia-flyers-tue-fri-0900'),
  command := $command$
    select net.http_post(
      url := 'https://hwpsnipdkwxvvjowomlo.supabase.co/functions/v1/collect-marilia-flyers',
      headers := '{"Content-Type":"application/json"}'::jsonb,
      body := jsonb_build_object('scheduled_at',now(),'recheck',true,'readiness_deadline','09:00'),
      timeout_milliseconds := 150000
    );
  $command$
);

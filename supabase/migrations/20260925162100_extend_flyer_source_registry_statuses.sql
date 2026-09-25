alter table public.flyer_source_registry
  drop constraint if exists flyer_source_registry_status_check;

alter table public.flyer_source_registry
  add constraint flyer_source_registry_status_check
  check (
    status = any (
      array[
        'seen'::text,
        'unchanged'::text,
        'downloaded'::text,
        'processed'::text,
        'failed'::text,
        'expired'::text,
        'date_validation_failed'::text
      ]
    )
  );

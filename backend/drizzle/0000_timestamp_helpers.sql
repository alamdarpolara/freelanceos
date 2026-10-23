-- Migration owner creates this dedicated schema; do not reuse a pre-existing one.
CREATE SCHEMA app_private AUTHORIZATION CURRENT_USER;
--> statement-breakpoint
REVOKE ALL ON SCHEMA app_private FROM PUBLIC;
--> statement-breakpoint
CREATE FUNCTION app_private.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $function$
BEGIN
  NEW.updated_at := pg_catalog.now();
  RETURN NEW;
END;
$function$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_private.set_updated_at() FROM PUBLIC;

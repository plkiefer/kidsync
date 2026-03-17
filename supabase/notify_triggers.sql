-- ============================================================
-- Email notification triggers for KidSync
-- Fires the notify-parent Edge Function via pg_net whenever:
--   1. A calendar event is created, updated, or deleted
--   2. A custody override is created or its status changes
-- ============================================================
--
-- SETUP: Run this first if pg_net is not yet enabled:
--   CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
--
-- IMPORTANT: Before running, replace YOUR_SERVICE_ROLE_KEY_HERE
-- with your actual Supabase service role key (Settings → API).
-- ============================================================


-- ── Custody override trigger ──────────────────────────────────

CREATE OR REPLACE FUNCTION public.handle_custody_override_change()
RETURNS TRIGGER AS $$
DECLARE
  v_action     TEXT;
  v_changed_by UUID;
  v_snapshot   JSONB;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_action := 'requested';
    v_changed_by := NEW.created_by;
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.status IS DISTINCT FROM NEW.status THEN
      v_action := NEW.status; -- 'approved', 'disputed', or 'withdrawn'
      v_changed_by := COALESCE(NEW.responded_by, NEW.created_by);
    ELSE
      -- Non-status update (e.g. compliance check) — skip notification
      RETURN NEW;
    END IF;
  END IF;

  v_snapshot := to_jsonb(NEW);

  PERFORM net.http_post(
    url := 'https://logxqzyxeuggdcypwqks.supabase.co/functions/v1/notify-parent'::text,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer YOUR_SERVICE_ROLE_KEY_HERE'
    ),
    body := jsonb_build_object(
      'type', 'custody_override',
      'action', v_action,
      'override', v_snapshot,
      'family_id', NEW.family_id::text,
      'changed_by', v_changed_by::text
    )
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_custody_override_change ON public.custody_overrides;
CREATE TRIGGER on_custody_override_change
  AFTER INSERT OR UPDATE ON public.custody_overrides
  FOR EACH ROW EXECUTE FUNCTION public.handle_custody_override_change();


-- ── Calendar event trigger ────────────────────────────────────
-- (Only run this if the trigger doesn't already exist)

CREATE OR REPLACE FUNCTION public.handle_event_change()
RETURNS TRIGGER AS $$
DECLARE
  v_action      TEXT;
  v_event       RECORD;
  v_family_id   UUID;
  v_changed_by  UUID;
  v_snapshot    JSONB;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_action := 'created';
    v_event := NEW;
    v_family_id := NEW.family_id;
    v_changed_by := NEW.created_by;
  ELSIF TG_OP = 'UPDATE' THEN
    v_action := 'updated';
    v_event := NEW;
    v_family_id := NEW.family_id;
    v_changed_by := COALESCE(NEW.updated_by, NEW.created_by);
  ELSIF TG_OP = 'DELETE' THEN
    v_action := 'deleted';
    v_event := OLD;
    v_family_id := OLD.family_id;
    v_changed_by := OLD.updated_by;
  END IF;

  v_snapshot := to_jsonb(v_event);

  -- Insert change log
  INSERT INTO public.event_change_log
    (event_id, family_id, action, changed_by, event_snapshot)
  VALUES
    (v_event.id, v_family_id, v_action, v_changed_by, v_snapshot);

  -- Fire Edge Function for email notification
  PERFORM net.http_post(
    url := 'https://logxqzyxeuggdcypwqks.supabase.co/functions/v1/notify-parent'::text,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer YOUR_SERVICE_ROLE_KEY_HERE'
    ),
    body := jsonb_build_object(
      'action', v_action,
      'event', v_snapshot,
      'family_id', v_family_id::text,
      'changed_by', v_changed_by::text
    )
  );

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_event_change ON public.calendar_events;
CREATE TRIGGER on_event_change
  AFTER INSERT OR UPDATE OR DELETE ON public.calendar_events
  FOR EACH ROW EXECUTE FUNCTION public.handle_event_change();

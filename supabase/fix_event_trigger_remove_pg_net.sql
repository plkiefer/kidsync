-- ============================================================
-- One-time migration: remove net.http_post from the calendar_events
-- trigger so bulk imports don't block on per-row HTTP calls.
--
-- Run this ONCE against your Supabase project (SQL editor →
-- New query → paste → Run).
--
-- WHY: an AFTER INSERT FOR EACH ROW trigger that does
-- PERFORM net.http_post(...) blocks the parent INSERT statement
-- until every per-row HTTP enqueue returns. For a 20-event
-- bulk import that's 30-45s of dead time. Email notifications
-- now run client-side, where they're easier to dedupe / batch
-- (we never email 30 times for one bulk import).
--
-- After running this, schedule imports should land in 2-4
-- seconds instead of timing out.
-- ============================================================

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

  -- Change log (kept) — fast, pure SQL.
  INSERT INTO public.event_change_log
    (event_id, family_id, action, changed_by, event_snapshot)
  VALUES
    (v_event.id, v_family_id, v_action, v_changed_by, v_snapshot);

  -- Email notification (REMOVED) — moved to the client.
  -- Old line was:
  --   PERFORM net.http_post(url := '.../notify-parent', ...);

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger definition is unchanged; we only redefined the function.
-- (CREATE OR REPLACE FUNCTION applies the new body to the existing
-- trigger automatically.)

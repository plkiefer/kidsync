-- ============================================================
-- Change-log trigger for calendar events
-- ============================================================
--
-- ARCHITECTURE NOTE: this trigger is ONLY responsible for writing
-- to event_change_log (fast, pure SQL). Email notifications are
-- fired CLIENT-SIDE via supabase.functions.invoke("notify-parent")
-- after a successful write (see useEvents.ts createEvent /
-- updateEvent / deleteEvent and useCustody.ts notifyCustodyChange).
--
-- WHY: an earlier version of this trigger called net.http_post()
-- per row inside an AFTER INSERT FOR EACH ROW trigger. For a 20-
-- row batch import that meant 20 synchronous HTTP enqueues inside
-- the transaction, with the supabase-js INSERT call blocked until
-- every trigger invocation returned. The wall-clock to commit a
-- 20-row insert was 30-45+ seconds, breaking the schedule importer.
-- The notification is fundamentally a side effect, not part of the
-- write — keeping it out of the trigger keeps writes fast and lets
-- the client decide what to batch (e.g. one summary email for an
-- import, instead of 20 individual emails).
--
-- Bulk imports (createEventsBatch / updateEventsBatch) intentionally
-- DO NOT call notify-parent — the other parent will see the events
-- on the calendar; we don't email them 30 times for one import.
-- ============================================================

-- ── Calendar event trigger ────────────────────────────────────

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

  -- Insert change log (fast, no network)
  INSERT INTO public.event_change_log
    (event_id, family_id, action, changed_by, event_snapshot)
  VALUES
    (v_event.id, v_family_id, v_action, v_changed_by, v_snapshot);

  -- NOTE: no net.http_post here. See architecture note at the top.
  -- Email notifications happen client-side after a successful write.

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

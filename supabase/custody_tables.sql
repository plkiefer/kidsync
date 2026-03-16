-- Custody schedule patterns (one per kid)
CREATE TABLE IF NOT EXISTS custody_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id UUID REFERENCES families(id) NOT NULL,
  kid_id UUID REFERENCES kids(id) NOT NULL,
  pattern_type TEXT NOT NULL DEFAULT 'alternating_weeks',
  parent_a_id UUID NOT NULL, -- e.g., Dad (the "every other weekend" parent)
  parent_b_id UUID NOT NULL, -- e.g., Mom (primary custodian on weekdays)
  anchor_date DATE NOT NULL, -- a known date when parent_a's weekend starts (a Friday)
  pattern_days JSONB DEFAULT '[5, 6, 0]', -- Fri, Sat, Sun
  fixed_day_map JSONB, -- for fixed_days pattern: { "0": "parent_id", ... }
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(family_id, kid_id)
);

-- Custody overrides with compliance tracking and dispute workflow
CREATE TABLE IF NOT EXISTS custody_overrides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id UUID REFERENCES families(id) NOT NULL,
  kid_id UUID REFERENCES kids(id) NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  parent_id UUID NOT NULL, -- who has custody during this override
  note TEXT, -- description of the change
  reason TEXT, -- why this override is needed (required if non-compliant)
  -- Compliance
  compliance_status TEXT DEFAULT 'unchecked', -- unchecked, compliant, flagged
  compliance_issues JSONB, -- AI-detected issues
  compliance_checked_at TIMESTAMPTZ,
  -- Approval workflow
  status TEXT DEFAULT 'pending', -- pending, approved, disputed, withdrawn
  created_by UUID,
  -- Response from other parent
  responded_by UUID,
  responded_at TIMESTAMPTZ,
  response_note TEXT, -- other parent's comment when approving/disputing
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Custody agreements (uploaded legal docs + AI-parsed terms)
CREATE TABLE IF NOT EXISTS custody_agreements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id UUID REFERENCES families(id) NOT NULL,
  file_name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  parsed_terms JSONB,
  raw_text TEXT,
  parsed_at TIMESTAMPTZ,
  uploaded_by UUID,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE custody_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE custody_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE custody_agreements ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Family members can view custody schedules"
  ON custody_schedules FOR SELECT
  USING (family_id IN (SELECT family_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "Family members can manage custody schedules"
  ON custody_schedules FOR ALL
  USING (family_id IN (SELECT family_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "Family members can view custody overrides"
  ON custody_overrides FOR SELECT
  USING (family_id IN (SELECT family_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "Family members can manage custody overrides"
  ON custody_overrides FOR ALL
  USING (family_id IN (SELECT family_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "Family members can view custody agreements"
  ON custody_agreements FOR SELECT
  USING (family_id IN (SELECT family_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "Family members can manage custody agreements"
  ON custody_agreements FOR ALL
  USING (family_id IN (SELECT family_id FROM profiles WHERE id = auth.uid()));

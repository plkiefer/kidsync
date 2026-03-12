"use client";

import { useState } from "react";
import {
  TravelFormData,
  FlightLeg,
  TravelDocument,
  PackingItem,
  EventTravelDetails,
  DOCUMENT_TYPES,
} from "@/lib/types";
import { toDateTimeLocal } from "@/lib/dates";
import {
  X,
  Plane,
  Building2,
  Phone,
  FileText,
  Package,
  Plus,
  Trash2,
  ChevronDown,
  ChevronRight,
} from "lucide-react";

interface TravelModalProps {
  existing?: EventTravelDetails | null;
  onSave: (data: TravelFormData) => void;
  onClose: () => void;
}

function emptyFlightLeg(leg: number, direction: "outbound" | "return"): FlightLeg {
  return {
    leg,
    direction,
    carrier: "",
    flight_number: "",
    departure_airport: "",
    arrival_airport: "",
    departure_time: "",
    arrival_time: "",
    confirmation: "",
    seat: "",
    notes: "",
  };
}

function emptyDocument(): TravelDocument {
  return {
    type: "other",
    for: "",
    status: "needed",
    notes: "",
  };
}

function emptyPackingItem(): PackingItem {
  return { item: "", packed: false };
}

const inputCls =
  "w-full px-3 py-2 bg-[var(--color-input)] border border-[var(--color-border)] rounded-lg text-[var(--color-text)] text-xs focus:outline-none focus:border-[var(--color-accent)] transition-all placeholder-[var(--color-text-faint)]";

const labelCls =
  "block text-[10px] font-semibold text-[var(--color-text-faint)] uppercase tracking-wider mb-1";

function Section({
  title,
  icon,
  children,
  defaultOpen = true,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="border border-[var(--color-divider)] rounded-xl overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2.5 px-4 py-3 bg-[var(--color-surface-alt)] text-left hover:bg-[var(--color-input)] transition-colors"
      >
        {icon}
        <span className="text-xs font-bold text-[var(--color-text-muted)] uppercase tracking-wider flex-1">
          {title}
        </span>
        {open ? (
          <ChevronDown size={14} className="text-[var(--color-text-faint)]" />
        ) : (
          <ChevronRight size={14} className="text-[var(--color-text-faint)]" />
        )}
      </button>
      {open && <div className="p-4 space-y-3">{children}</div>}
    </div>
  );
}

export default function TravelModal({
  existing,
  onSave,
  onClose,
}: TravelModalProps) {
  const [form, setForm] = useState<TravelFormData>({
    lodging_name: existing?.lodging_name || "",
    lodging_address: existing?.lodging_address || "",
    lodging_phone: existing?.lodging_phone || "",
    lodging_confirmation: existing?.lodging_confirmation || "",
    lodging_check_in: existing?.lodging_check_in
      ? toDateTimeLocal(new Date(existing.lodging_check_in))
      : "",
    lodging_check_out: existing?.lodging_check_out
      ? toDateTimeLocal(new Date(existing.lodging_check_out))
      : "",
    lodging_notes: existing?.lodging_notes || "",
    flights: existing?.flights?.length
      ? existing.flights
      : [emptyFlightLeg(1, "outbound")],
    ground_transport: existing?.ground_transport || [],
    emergency_name: existing?.emergency_name || "",
    emergency_phone: existing?.emergency_phone || "",
    emergency_relation: existing?.emergency_relation || "",
    emergency_notes: existing?.emergency_notes || "",
    documents: existing?.documents?.length
      ? existing.documents
      : [emptyDocument()],
    destination_address: existing?.destination_address || "",
    destination_phone: existing?.destination_phone || "",
    destination_notes: existing?.destination_notes || "",
    packing_checklist: existing?.packing_checklist?.length
      ? existing.packing_checklist
      : [emptyPackingItem()],
  });

  const updateField = (field: keyof TravelFormData, value: any) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  // ── Flight helpers ──
  const updateFlight = (index: number, field: keyof FlightLeg, value: string) => {
    const updated = [...form.flights];
    updated[index] = { ...updated[index], [field]: value };
    updateField("flights", updated);
  };

  const addFlight = () => {
    const next = form.flights.length + 1;
    updateField("flights", [
      ...form.flights,
      emptyFlightLeg(next, next <= 1 ? "outbound" : "return"),
    ]);
  };

  const removeFlight = (index: number) => {
    updateField(
      "flights",
      form.flights.filter((_, i) => i !== index)
    );
  };

  // ── Document helpers ──
  const updateDocument = (
    index: number,
    field: keyof TravelDocument,
    value: string
  ) => {
    const updated = [...form.documents];
    updated[index] = { ...updated[index], [field]: value };
    updateField("documents", updated);
  };

  const addDocument = () => {
    updateField("documents", [...form.documents, emptyDocument()]);
  };

  const removeDocument = (index: number) => {
    updateField(
      "documents",
      form.documents.filter((_, i) => i !== index)
    );
  };

  // ── Packing helpers ──
  const updatePackingItem = (index: number, field: keyof PackingItem, value: string | boolean) => {
    const updated = [...form.packing_checklist];
    updated[index] = { ...updated[index], [field]: value };
    updateField("packing_checklist", updated);
  };

  const addPackingItem = () => {
    updateField("packing_checklist", [
      ...form.packing_checklist,
      emptyPackingItem(),
    ]);
  };

  const removePackingItem = (index: number) => {
    updateField(
      "packing_checklist",
      form.packing_checklist.filter((_, i) => i !== index)
    );
  };

  const handleSubmit = () => {
    // Clean up empty entries
    const cleaned: TravelFormData = {
      ...form,
      flights: form.flights.filter((f) => f.carrier || f.flight_number),
      documents: form.documents.filter((d) => d.type !== "other" || d.notes),
      packing_checklist: form.packing_checklist.filter((p) => p.item.trim()),
      lodging_check_in: form.lodging_check_in
        ? new Date(form.lodging_check_in).toISOString()
        : "",
      lodging_check_out: form.lodging_check_out
        ? new Date(form.lodging_check_out).toISOString()
        : "",
    };
    onSave(cleaned);
  };

  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-[var(--color-surface)] rounded-2xl w-full max-w-lg max-h-[92vh] flex flex-col border border-[var(--color-border)] shadow-[var(--shadow-modal)] animate-scale-in"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-6 pb-4 border-b border-[var(--color-divider)] shrink-0">
          <div>
            <h2 className="font-display text-xl text-[var(--color-text)]">
              ✈️ Travel Details
            </h2>
            <p className="text-xs text-[var(--color-text-faint)] mt-0.5">
              Flight info, lodging, documents, packing
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg bg-[var(--color-input)] text-[var(--color-text-muted)] flex items-center justify-center hover:bg-[var(--color-surface-alt)] transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {/* ── FLIGHTS ── */}
          <Section
            title="Flights"
            icon={<Plane size={14} className="text-cyan-400" />}
          >
            {form.flights.map((flight, i) => (
              <div
                key={i}
                className="p-3 bg-[var(--color-surface-alt)] rounded-lg border border-[var(--color-divider)] space-y-2"
              >
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold text-[var(--color-text-muted)] uppercase">
                    Leg {flight.leg} — {flight.direction}
                  </span>
                  {form.flights.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeFlight(i)}
                      className="text-red-400/60 hover:text-red-400"
                    >
                      <Trash2 size={12} />
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className={labelCls}>Carrier</label>
                    <input
                      className={inputCls}
                      value={flight.carrier}
                      onChange={(e) => updateFlight(i, "carrier", e.target.value)}
                      placeholder="United"
                    />
                  </div>
                  <div>
                    <label className={labelCls}>Flight #</label>
                    <input
                      className={inputCls}
                      value={flight.flight_number}
                      onChange={(e) =>
                        updateFlight(i, "flight_number", e.target.value)
                      }
                      placeholder="UA 1234"
                    />
                  </div>
                  <div>
                    <label className={labelCls}>From</label>
                    <input
                      className={inputCls}
                      value={flight.departure_airport}
                      onChange={(e) =>
                        updateFlight(i, "departure_airport", e.target.value)
                      }
                      placeholder="DCA"
                    />
                  </div>
                  <div>
                    <label className={labelCls}>To</label>
                    <input
                      className={inputCls}
                      value={flight.arrival_airport}
                      onChange={(e) =>
                        updateFlight(i, "arrival_airport", e.target.value)
                      }
                      placeholder="MCI"
                    />
                  </div>
                  <div>
                    <label className={labelCls}>Departs</label>
                    <input
                      type="datetime-local"
                      className={`${inputCls}`}
                      value={flight.departure_time ? toDateTimeLocal(new Date(flight.departure_time)) : ""}
                      onChange={(e) =>
                        updateFlight(
                          i,
                          "departure_time",
                          e.target.value ? new Date(e.target.value).toISOString() : ""
                        )
                      }
                    />
                  </div>
                  <div>
                    <label className={labelCls}>Arrives</label>
                    <input
                      type="datetime-local"
                      className={`${inputCls}`}
                      value={flight.arrival_time ? toDateTimeLocal(new Date(flight.arrival_time)) : ""}
                      onChange={(e) =>
                        updateFlight(
                          i,
                          "arrival_time",
                          e.target.value ? new Date(e.target.value).toISOString() : ""
                        )
                      }
                    />
                  </div>
                  <div>
                    <label className={labelCls}>Confirmation #</label>
                    <input
                      className={inputCls}
                      value={flight.confirmation}
                      onChange={(e) =>
                        updateFlight(i, "confirmation", e.target.value)
                      }
                      placeholder="ABC123"
                    />
                  </div>
                  <div>
                    <label className={labelCls}>Seat</label>
                    <input
                      className={inputCls}
                      value={flight.seat}
                      onChange={(e) => updateFlight(i, "seat", e.target.value)}
                      placeholder="12A"
                    />
                  </div>
                </div>
                <div>
                  <label className={labelCls}>Notes</label>
                  <input
                    className={inputCls}
                    value={flight.notes}
                    onChange={(e) => updateFlight(i, "notes", e.target.value)}
                    placeholder="Window seat for Ethan"
                  />
                </div>
              </div>
            ))}
            <button
              type="button"
              onClick={addFlight}
              className="flex items-center gap-1.5 text-xs text-[var(--color-accent)] font-semibold hover:text-[var(--color-accent)] transition-colors"
            >
              <Plus size={12} /> Add Flight Leg
            </button>
          </Section>

          {/* ── LODGING ── */}
          <Section
            title="Lodging"
            icon={<Building2 size={14} className="text-[var(--color-tag-updated-text)]" />}
          >
            <div className="grid grid-cols-2 gap-2">
              <div className="col-span-2">
                <label className={labelCls}>Name</label>
                <input
                  className={inputCls}
                  value={form.lodging_name}
                  onChange={(e) => updateField("lodging_name", e.target.value)}
                  placeholder="Marriott Residence Inn"
                />
              </div>
              <div className="col-span-2">
                <label className={labelCls}>Address</label>
                <input
                  className={inputCls}
                  value={form.lodging_address}
                  onChange={(e) =>
                    updateField("lodging_address", e.target.value)
                  }
                  placeholder="123 Oak St, Kansas City, MO"
                />
              </div>
              <div>
                <label className={labelCls}>Phone</label>
                <input
                  className={inputCls}
                  value={form.lodging_phone}
                  onChange={(e) => updateField("lodging_phone", e.target.value)}
                  placeholder="(555) 123-4567"
                />
              </div>
              <div>
                <label className={labelCls}>Confirmation #</label>
                <input
                  className={inputCls}
                  value={form.lodging_confirmation}
                  onChange={(e) =>
                    updateField("lodging_confirmation", e.target.value)
                  }
                  placeholder="CONF12345"
                />
              </div>
              <div>
                <label className={labelCls}>Check In</label>
                <input
                  type="datetime-local"
                  className={`${inputCls}`}
                  value={form.lodging_check_in}
                  onChange={(e) =>
                    updateField("lodging_check_in", e.target.value)
                  }
                />
              </div>
              <div>
                <label className={labelCls}>Check Out</label>
                <input
                  type="datetime-local"
                  className={`${inputCls}`}
                  value={form.lodging_check_out}
                  onChange={(e) =>
                    updateField("lodging_check_out", e.target.value)
                  }
                />
              </div>
              <div className="col-span-2">
                <label className={labelCls}>Notes</label>
                <input
                  className={inputCls}
                  value={form.lodging_notes}
                  onChange={(e) => updateField("lodging_notes", e.target.value)}
                  placeholder="Room block under Smith"
                />
              </div>
            </div>
          </Section>

          {/* ── EMERGENCY CONTACT ── */}
          <Section
            title="Emergency Contact"
            icon={<Phone size={14} className="text-red-400" />}
          >
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className={labelCls}>Name</label>
                <input
                  className={inputCls}
                  value={form.emergency_name}
                  onChange={(e) =>
                    updateField("emergency_name", e.target.value)
                  }
                  placeholder="Grandma Jane"
                />
              </div>
              <div>
                <label className={labelCls}>Phone</label>
                <input
                  className={inputCls}
                  value={form.emergency_phone}
                  onChange={(e) =>
                    updateField("emergency_phone", e.target.value)
                  }
                  placeholder="(555) 987-6543"
                />
              </div>
              <div>
                <label className={labelCls}>Relation</label>
                <input
                  className={inputCls}
                  value={form.emergency_relation}
                  onChange={(e) =>
                    updateField("emergency_relation", e.target.value)
                  }
                  placeholder="Maternal grandmother"
                />
              </div>
              <div>
                <label className={labelCls}>Notes</label>
                <input
                  className={inputCls}
                  value={form.emergency_notes}
                  onChange={(e) =>
                    updateField("emergency_notes", e.target.value)
                  }
                  placeholder="Staying nearby"
                />
              </div>
            </div>
          </Section>

          {/* ── DOCUMENTS ── */}
          <Section
            title="Documents & IDs"
            icon={<FileText size={14} className="text-[var(--color-tag-created-text)]" />}
            defaultOpen={false}
          >
            {form.documents.map((doc, i) => (
              <div
                key={i}
                className="flex items-start gap-2 p-2 bg-[var(--color-surface-alt)] rounded-lg"
              >
                <div className="flex-1 grid grid-cols-2 gap-2">
                  <div>
                    <label className={labelCls}>Type</label>
                    <select
                      className={inputCls}
                      value={doc.type}
                      onChange={(e) => updateDocument(i, "type", e.target.value)}
                    >
                      {DOCUMENT_TYPES.map((dt) => (
                        <option key={dt.value} value={dt.value}>
                          {dt.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className={labelCls}>For</label>
                    <input
                      className={inputCls}
                      value={doc.for}
                      onChange={(e) => updateDocument(i, "for", e.target.value)}
                      placeholder="Ethan"
                    />
                  </div>
                  <div>
                    <label className={labelCls}>Status</label>
                    <select
                      className={inputCls}
                      value={doc.status}
                      onChange={(e) =>
                        updateDocument(i, "status", e.target.value)
                      }
                    >
                      <option value="needed">Needed</option>
                      <option value="packed">Packed</option>
                      <option value="in_wallet">In Wallet</option>
                      <option value="digital">Digital</option>
                    </select>
                  </div>
                  <div>
                    <label className={labelCls}>Notes</label>
                    <input
                      className={inputCls}
                      value={doc.notes || ""}
                      onChange={(e) =>
                        updateDocument(i, "notes", e.target.value)
                      }
                      placeholder="Details..."
                    />
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => removeDocument(i)}
                  className="mt-5 text-red-400/60 hover:text-red-400 p-1"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={addDocument}
              className="flex items-center gap-1.5 text-xs text-[var(--color-accent)] font-semibold hover:text-[var(--color-accent)] transition-colors"
            >
              <Plus size={12} /> Add Document
            </button>
          </Section>

          {/* ── PACKING CHECKLIST ── */}
          <Section
            title="Packing Checklist"
            icon={<Package size={14} className="text-violet-400" />}
            defaultOpen={false}
          >
            {form.packing_checklist.map((item, i) => (
              <div key={i} className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => updatePackingItem(i, "packed", !item.packed)}
                  className={`
                    w-5 h-5 rounded border shrink-0 flex items-center justify-center transition-all text-xs
                    ${
                      item.packed
                        ? "bg-emerald-500/20 border-emerald-500 text-[var(--color-tag-created-text)]"
                        : "border-[var(--color-border)] hover:border-[var(--color-text-faint)]"
                    }
                  `}
                >
                  {item.packed && "✓"}
                </button>
                <input
                  className={`flex-1 ${inputCls} ${
                    item.packed ? "line-through text-[var(--color-text-faint)]" : ""
                  }`}
                  value={item.item}
                  onChange={(e) =>
                    updatePackingItem(i, "item", e.target.value)
                  }
                  placeholder="Item to pack..."
                />
                <button
                  type="button"
                  onClick={() => removePackingItem(i)}
                  className="text-red-400/60 hover:text-red-400 p-1"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={addPackingItem}
              className="flex items-center gap-1.5 text-xs text-[var(--color-accent)] font-semibold hover:text-[var(--color-accent)] transition-colors"
            >
              <Plus size={12} /> Add Item
            </button>
          </Section>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 p-6 pt-4 border-t border-[var(--color-divider)] shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2.5 rounded-xl border border-[var(--color-border)] text-[var(--color-text-muted)] text-xs font-semibold hover:bg-[var(--color-surface-alt)] transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 text-white text-xs font-semibold shadow-lg shadow-cyan-500/25 hover:shadow-cyan-500/40 transition-all"
          >
            Save Travel Details
          </button>
        </div>
      </div>
    </div>
  );
}

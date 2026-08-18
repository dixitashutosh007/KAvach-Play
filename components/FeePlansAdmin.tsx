import { useState } from "react";
import { useStore } from "@/hooks/useStore";
import { FeePlan } from "@/lib/types";
import { Trash2 as TrashIcon, Edit2, X } from "lucide-react";

const PLAN_TYPES: { value: FeePlan["type"]; label: string; desc: string }[] = [
  { value: "fixed", label: "Fixed Fee", desc: "Override match fee with a fixed amount per match" },
  { value: "monthly", label: "Monthly Subscription", desc: "Monthly amount — offsets match fees when active" },
  { value: "sponsored", label: "Club Sponsored", desc: "Fee set to ₹0 (club pays)" },
];

export function FeePlansAdmin({ store }: { store: ReturnType<typeof useStore> }) {
  const [name, setName] = useState("");
  const [type, setType] = useState<FeePlan["type"]>("fixed");
  const [feeAmount, setFeeAmount] = useState("");
  const [monthlyAmount, setMonthlyAmount] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);

  const resetForm = () => {
    setName("");
    setType("fixed");
    setFeeAmount("");
    setMonthlyAmount("");
    setEditingId(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name) return;

    const plan: Omit<FeePlan, "id" | "createdAt" | "updatedAt"> = {
      name,
      type,
      isActive: true,
    };
    if (type === "fixed") plan.feeAmount = parseFloat(feeAmount) || 0;
    if (type === "monthly") plan.monthlyAmount = parseFloat(monthlyAmount) || 0;

    try {
      if (editingId) {
        await store.updateFeePlan(editingId, plan);
      } else {
        await store.addFeePlan(plan as any);
      }
      resetForm();
    } catch (err) {
      console.error(err);
      alert("Failed to save fee plan.");
    }
  };

  const startEdit = (plan: FeePlan) => {
    setEditingId(plan.id);
    setName(plan.name);
    setType(plan.type);
    setFeeAmount(plan.feeAmount !== undefined ? String(plan.feeAmount) : "");
    setMonthlyAmount(plan.monthlyAmount !== undefined ? String(plan.monthlyAmount) : "");
  };

  const typeInfo = PLAN_TYPES.find((t) => t.value === type);

  return (
    <div className="space-y-6">
      <div className="glass rounded-xl p-5 border border-glass-border">
        <h3 className="text-[12px] font-bold uppercase tracking-widest text-amber-400 mb-4">
          {editingId ? "Edit Fee Plan" : "Create Fee Plan"}
        </h3>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="text-[10px] font-bold uppercase tracking-wider text-white/50 mb-1 block">
              Plan Name
            </label>
            <input
              type="text"
              placeholder="e.g. Youth Fixed Fee 350"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full bg-black/40 border border-glass-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent text-white"
              required
            />
          </div>
          <div>
            <label className="text-[10px] font-bold uppercase tracking-wider text-white/50 mb-1 block">
              Plan Type
            </label>
            <select
              value={type}
              onChange={(e) => setType(e.target.value as FeePlan["type"])}
              className="w-full bg-black/40 border border-glass-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent text-white [&>option]:bg-neutral-950"
            >
              {PLAN_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
            {typeInfo && (
              <p className="text-[10px] text-white/40 mt-1">{typeInfo.desc}</p>
            )}
          </div>

          {type === "fixed" && (
            <div>
              <label className="text-[10px] font-bold uppercase tracking-wider text-white/50 mb-1 block">
                Fee per Match (₹)
              </label>
              <input
                type="number"
                placeholder="e.g. 350"
                value={feeAmount}
                onChange={(e) => setFeeAmount(e.target.value)}
                className="w-full bg-black/40 border border-glass-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent text-white"
                required
                min="0"
              />
            </div>
          )}

          {type === "monthly" && (
            <div>
              <label className="text-[10px] font-bold uppercase tracking-wider text-white/50 mb-1 block">
                Monthly Amount (₹)
              </label>
              <input
                type="number"
                placeholder="e.g. 1500"
                value={monthlyAmount}
                onChange={(e) => setMonthlyAmount(e.target.value)}
                className="w-full bg-black/40 border border-glass-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent text-white"
                required
                min="0"
              />
            </div>
          )}

          <div className="flex gap-2">
            <button
              type="submit"
              disabled={!name}
              className="flex-1 bg-accent text-black font-bold py-2.5 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition shadow text-sm"
            >
              {editingId ? "Update Plan" : "Create Plan"}
            </button>
            {editingId && (
              <button
                type="button"
                onClick={resetForm}
                className="px-4 py-2.5 rounded-lg bg-white/5 text-white/70 hover:bg-white/10 transition text-sm font-bold"
              >
                Cancel
              </button>
            )}
          </div>
        </form>

        <div className="mt-6">
          <h4 className="text-[10px] font-bold uppercase tracking-widest text-white/50 mb-2">
            Saved Plans
          </h4>
          <div className="space-y-2 max-h-64 overflow-y-auto pr-2">
            {store.feePlans.length === 0 && (
              <div className="text-xs text-white/30 italic text-center p-4">
                No fee plans created yet
              </div>
            )}
            {store.feePlans.map((plan: FeePlan) => {
              const desc =
                plan.type === "fixed"
                  ? `₹${plan.feeAmount} / match`
                  : plan.type === "monthly"
                    ? `₹${plan.monthlyAmount} / month`
                    : "₹0 (Club Sponsored)";
              return (
                <div
                  key={plan.id}
                  className={`flex justify-between items-center p-3 rounded-lg border ${
                    plan.isActive === false
                      ? "bg-black/10 border-white/5 opacity-50"
                      : "bg-black/20 border-glass-border"
                  }`}
                >
                  <div>
                    <div className="text-sm font-bold text-white flex items-center gap-2">
                      {plan.name}
                      <span className={`text-[9px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded border ${
                        plan.type === "fixed"
                          ? "bg-amber-500/10 text-amber-400 border-amber-500/20"
                          : plan.type === "monthly"
                            ? "bg-blue-500/10 text-blue-400 border-blue-500/20"
                            : "bg-green-500/10 text-green-400 border-green-500/20"
                      }`}>
                        {plan.type}
                      </span>
                    </div>
                    <div className="text-xs text-accent mt-0.5">{desc}</div>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => startEdit(plan)}
                      className="text-white/40 hover:text-accent p-1.5 transition"
                      title="Edit plan"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => {
                        if (confirm(`Delete "${plan.name}"?`)) {
                          store.deleteFeePlan(plan.id);
                        }
                      }}
                      className="text-red-400 hover:text-red-300 p-1.5 transition"
                      title="Delete plan"
                    >
                      <TrashIcon className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

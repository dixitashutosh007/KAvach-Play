import { useState } from "react";
import { useStore } from "@/hooks/useStore";
import { SubscriptionPlan } from "@/lib/types";
import { Calendar, Edit2, Plus, Trash2 } from "lucide-react";

export function PlansView({ store }: { store: ReturnType<typeof useStore> }) {
  const [editingPlan, setEditingPlan] = useState<SubscriptionPlan | null>(null);
  const [addingNew, setAddingNew] = useState(false);

  const [name, setName] = useState("");
  const [duration, setDuration] = useState<number>(30);
  const [fee, setFee] = useState<number>(0);
  const [benefits, setBenefits] = useState("");
  const [isActive, setIsActive] = useState<boolean>(true);

  const resetForm = () => {
    setEditingPlan(null);
    setAddingNew(false);
    setName("");
    setDuration(30);
    setFee(0);
    setBenefits("");
    setIsActive(true);
  };

  const handleEdit = (p: SubscriptionPlan) => {
    setEditingPlan(p);
    setName(p.name);
    setDuration(p.durationDays);
    setFee(p.fee);
    setBenefits(p.benefits);
    setIsActive(p.isActive !== false); // default true if undefined
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (editingPlan) {
      await store.updateSubscriptionPlan({
        ...editingPlan,
        name,
        durationDays: duration,
        fee,
        benefits,
        isActive,
      });
    } else {
      await store.addSubscriptionPlan({
        name,
        durationDays: duration,
        fee,
        benefits,
        isActive,
      });
    }
    resetForm();
  };

  const handleDelete = async (pid: string) => {
    if (
      confirm(
        "Delete this subscription plan? Unsure this won't break existing dependencies.",
      )
    ) {
      await store.deleteSubscriptionPlan(pid);
    }
  };

  const toggleStatus = async (plan: SubscriptionPlan) => {
    await store.updateSubscriptionPlan({
      ...plan,
      isActive: plan.isActive === false ? true : false,
    });
  };

  if (editingPlan || addingNew) {
    return (
      <div className="glass p-5 rounded-2xl border border-glass-border">
        <h3 className="text-sm font-bold text-white mb-4 uppercase tracking-wider">
          {addingNew ? "Add New Plan" : "Edit Plan"}
        </h3>
        <form onSubmit={handleSave} className="space-y-4">
          <div>
            <label className="text-[10px] font-bold uppercase tracking-widest text-white/50 mb-1 block">
              Plan Name
            </label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. 1 Month Pass"
              className="w-full rounded-xl border border-glass-border bg-black/40 px-3.5 py-2.5 text-sm text-white focus:border-accent focus:outline-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-[10px] font-bold uppercase tracking-widest text-white/50 mb-1 block">
                Duration (Days)
              </label>
              <input
                type="number"
                required
                value={duration}
                onChange={(e) => setDuration(Number(e.target.value))}
                className="w-full rounded-xl border border-glass-border bg-black/40 px-3.5 py-2.5 text-sm text-white focus:border-accent focus:outline-none"
              />
            </div>
            <div>
              <label className="text-[10px] font-bold uppercase tracking-widest text-white/50 mb-1 block">
                Fee (₹)
              </label>
              <input
                type="number"
                required
                value={fee}
                onChange={(e) => setFee(Number(e.target.value))}
                className="w-full rounded-xl border border-glass-border bg-black/40 px-3.5 py-2.5 text-sm text-white focus:border-accent focus:outline-none"
              />
            </div>
          </div>

          <div>
            <label className="text-[10px] font-bold uppercase tracking-widest text-white/50 mb-1 block">
              Benefits Outline
            </label>
            <textarea
              rows={3}
              required
              value={benefits}
              onChange={(e) => setBenefits(e.target.value)}
              placeholder="Live match recording, Analytics..."
              className="w-full rounded-xl border border-glass-border bg-black/40 px-3.5 py-2.5 text-sm text-white focus:border-accent focus:outline-none custom-scrollbar"
            />
          </div>

          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
              className="accent-accent"
            />
            <span className="text-sm text-white">Plan is Active</span>
          </label>

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={resetForm}
              className="flex-1 py-3 rounded-xl border border-white/10 text-white text-xs font-bold uppercase tracking-wider hover:bg-white/5 transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="flex-1 py-3 rounded-xl bg-accent text-black text-xs font-bold uppercase tracking-wider hover:opacity-90 transition shadow-lg"
            >
              Save Plan
            </button>
          </div>
        </form>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center bg-accent/5 border border-glass-border p-4 rounded-xl">
        <div>
          <h4 className="text-xs font-bold text-white uppercase tracking-wider">
            Subscription Tier Manager
          </h4>
          <p className="text-[11px] text-white/60">
            Configure Studio bundles for the squad.
          </p>
        </div>
        <button
          onClick={() => setAddingNew(true)}
          className="bg-accent text-black px-4 py-2 rounded-xl font-bold text-xs uppercase tracking-wider inline-flex items-center gap-2 hover:opacity-90 transition shrink-0"
        >
          <Plus className="w-4 h-4" /> New Plan
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {store.subscriptionPlans.map((plan) => {
          const planIsActive = plan.isActive !== false;
          return (
            <div
              key={plan.id}
              className={`bg-black/30 border ${planIsActive ? "border-glass-border hover:border-accent/30" : "border-red-900/30 opacity-60"} rounded-xl p-5 relative overflow-hidden flex flex-col transition`}
            >
              <div className="absolute top-0 right-0 w-24 h-24 bg-accent/5 rounded-full blur-2xl pointer-events-none" />

              <div className="flex justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <h4
                      className={`text-sm font-black uppercase ${planIsActive ? "text-white" : "text-white/50 line-through"}`}
                    >
                      {plan.name}
                    </h4>
                    {!planIsActive && (
                      <span className="text-[8px] bg-red-500/20 text-red-400 px-1.5 py-0.5 rounded font-bold uppercase">
                        Disabled
                      </span>
                    )}
                  </div>
                  <p className="text-accent font-bold mt-0.5">₹{plan.fee}</p>
                  <p className="text-[10px] text-white/50 uppercase tracking-widest mt-1">
                    <Calendar className="inline w-3 h-3 mr-1" />{" "}
                    {plan.durationDays} Days Duration
                  </p>
                </div>
                <div className="flex items-start gap-1 shrink-0">
                  <button
                    onClick={() => toggleStatus(plan)}
                    className="p-1.5 text-white/50 hover:text-white transition text-xs border border-glass-border rounded bg-white/5 mr-2"
                  >
                    {planIsActive ? "Disable" : "Enable"}
                  </button>
                  <button
                    onClick={() => handleEdit(plan)}
                    className="p-1.5 text-white/50 hover:text-white transition"
                  >
                    <Edit2 className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => handleDelete(plan.id)}
                    className="p-1.5 text-rose-500/50 hover:text-rose-400 transition"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>

              <div className="mt-4 pt-3 border-t border-glass-border text-xs text-white/70">
                <p className="whitespace-pre-line">{plan.benefits}</p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

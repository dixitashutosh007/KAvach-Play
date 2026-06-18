import { useState } from "react";
import { useStore } from "@/hooks/useStore";
import { Trash2 as TrashIcon } from "lucide-react";

export function CreateFeeAdmin({
  store,
}: {
  store: ReturnType<typeof useStore>;
}) {
  const [templateName, setTemplateName] = useState("");
  const [templateAmount, setTemplateAmount] = useState("");

  const handleCreateTemplate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!templateName || !templateAmount) return;
    const amount = parseFloat(templateAmount);
    try {
      await store.addFeeTemplate(templateName, isNaN(amount) ? 0 : amount);
      setTemplateName("");
      setTemplateAmount("");
      alert("Fee Template added successfully!");
    } catch (err) {
      console.error(err);
      alert("Failed to create template.");
    }
  };

  return (
    <div className="space-y-6">
      <div className="glass rounded-xl p-5 border border-glass-border">
        <h3 className="text-[12px] font-bold uppercase tracking-widest text-accent mb-4">
          Create Custom Fee
        </h3>
        <form onSubmit={handleCreateTemplate} className="space-y-4">
          <div>
            <label className="text-[10px] font-bold uppercase tracking-wider text-white/50 mb-1 block">
              Fee Name
            </label>
            <input
              type="text"
              placeholder="e.g. Club Jersey"
              value={templateName}
              onChange={(e) => setTemplateName(e.target.value)}
              className="w-full bg-black/40 border border-glass-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent text-white"
              required
            />
          </div>
          <div>
            <label className="text-[10px] font-bold uppercase tracking-wider text-white/50 mb-1 block">
              Amount (₹)
            </label>
            <input
              type="number"
              placeholder="0"
              value={templateAmount}
              onChange={(e) => setTemplateAmount(e.target.value)}
              className="w-full bg-black/40 border border-glass-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent text-white"
              required
              min="1"
            />
          </div>
          <button
            type="submit"
            disabled={!templateName || !templateAmount}
            className="w-full bg-accent text-black font-bold py-2.5 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition shadow text-sm mt-2"
          >
            Save Fee Template
          </button>
        </form>

        <div className="mt-6">
          <h4 className="text-[10px] font-bold uppercase tracking-widest text-white/50 mb-2">
            Saved Fees
          </h4>
          <div className="space-y-2 max-h-48 overflow-y-auto pr-2">
            {(!store.feeTemplates || store.feeTemplates.length === 0) && (
              <div className="text-xs text-white/30 italic text-center p-4">
                No fees created yet
              </div>
            )}
            {store.feeTemplates?.map((t) => (
              <div
                key={t.id}
                className="flex justify-between items-center p-2 rounded bg-black/20 border border-glass-border"
              >
                <div>
                  <div className="text-sm font-bold text-white">{t.name}</div>
                  <div className="text-xs text-accent">₹{t.amount}</div>
                </div>
                <button
                  onClick={() => store.deleteFeeTemplate(t.id)}
                  className="text-red-400 hover:text-red-300 p-1"
                >
                  <TrashIcon className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

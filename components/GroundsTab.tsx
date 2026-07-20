import { useStore } from "@/hooks/useStore";
import { Copy, MapPin, Plus, Edit2, Trash2 } from "lucide-react";
import { useState } from "react";

export function GroundsTab({
  store,
  persona,
}: {
  store: ReturnType<typeof useStore>;
  persona: string;
}) {
  const isAdmin = persona === "admin";
  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    name: "",
    mapUrl: "",
    organiserName: "",
    gpayNumber: "",
    practiceFee: 0,
    tournamentFee: 0,
  });

  const handleCreateOrUpdate = (e: React.FormEvent) => {
    e.preventDefault();
    if (editingId) {
      store.updateGround(editingId, formData);
      setEditingId(null);
    } else {
      store.addGround(formData);
    }
    setIsAdding(false);
    setFormData({ name: "", mapUrl: "", organiserName: "", gpayNumber: "", practiceFee: 0, tournamentFee: 0 });
  };

  const handleEdit = (ground: any) => {
    setFormData({
      name: ground.name || "",
      mapUrl: ground.mapUrl || "",
      organiserName: ground.organiserName || "",
      gpayNumber: ground.gpayNumber || "",
      practiceFee: ground.practiceFee || 0,
      tournamentFee: ground.tournamentFee || 0,
    });
    setEditingId(ground.id);
    setIsAdding(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleDuplicate = (ground: any) => {
    store.addGround({
      name: `${ground.name} (Copy)`,
      mapUrl: ground.mapUrl || "",
      organiserName: ground.organiserName || "",
      gpayNumber: ground.gpayNumber || "",
      practiceFee: ground.practiceFee || 0,
      tournamentFee: ground.tournamentFee || 0,
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleDelete = (id: string) => {
    if (window.confirm("Are you sure you want to remove this ground?")) {
      store.deleteGround(id);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold tracking-tight text-white">
          Grounds Network
        </h2>
        {isAdmin && (
          <button
            onClick={() => {
              if (isAdding) {
                setIsAdding(false);
                setEditingId(null);
                setFormData({
                  name: "",
                  mapUrl: "",
                  organiserName: "",
                  gpayNumber: "",
                  practiceFee: 0,
                  tournamentFee: 0,
                });
              } else {
                setIsAdding(true);
                window.scrollTo({ top: 0, behavior: "smooth" });
              }
            }}
            className="flex items-center gap-1 rounded-full bg-accent px-3 py-1.5 text-sm font-medium text-black shadow hover:bg-accent/90 transition"
          >
            <Plus className="h-4 w-4" />
            {isAdding ? "Cancel" : "Add Ground"}
          </button>
        )}
      </div>

      {isAdding && (
        <form
          onSubmit={handleCreateOrUpdate}
          className="glass p-4 space-y-3 rounded-xl border border-accent/20 relative"
        >
          <h3 className="text-sm font-bold text-accent mb-2 uppercase tracking-wide">
            {editingId ? "Edit Ground" : "New Ground"}
          </h3>
          <div>
            <label className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-white/70">
              Ground Name
            </label>
            <input
              required
              type="text"
              value={formData.name}
              onChange={(e) =>
                setFormData({ ...formData, name: e.target.value })
              }
              className="w-full rounded-lg border border-glass-border bg-white/5 px-3 py-2 text-sm text-white focus:border-accent focus:outline-none"
              placeholder="e.g. Lords Cricket Ground"
            />
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-white/70">
              Google Map URL
            </label>
            <input
              required
              type="url"
              value={formData.mapUrl}
              onChange={(e) =>
                setFormData({ ...formData, mapUrl: e.target.value })
              }
              className="w-full rounded-lg border border-glass-border bg-white/5 px-3 py-2 text-sm text-white focus:border-accent focus:outline-none"
              placeholder="https://maps.app.goo.gl/..."
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-white/70">
                Organiser Name
              </label>
              <input
                required
                type="text"
                value={formData.organiserName}
                onChange={(e) =>
                  setFormData({ ...formData, organiserName: e.target.value })
                }
                className="w-full rounded-lg border border-glass-border bg-white/5 px-3 py-2 text-sm text-white focus:border-accent focus:outline-none"
                placeholder="e.g. Rajesh"
              />
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-white/70">
                GPay Number
              </label>
              <input
                required
                type="tel"
                value={formData.gpayNumber}
                onChange={(e) =>
                  setFormData({ ...formData, gpayNumber: e.target.value })
                }
                className="w-full rounded-lg border border-glass-border bg-white/5 px-3 py-2 text-sm text-white focus:border-accent focus:outline-none"
                placeholder="e.g. 9876543210"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 flex justify-between text-[11px] font-bold uppercase tracking-wider text-white/70">
                <span>Practice Fee (₹)</span><span className="text-white/40 normal-case tracking-normal font-normal text-[10px]">(Optional)</span>
              </label>
              <input
                type="number"
                min="0"
                value={formData.practiceFee}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    practiceFee: e.target.value === "" ? 0 : parseInt(e.target.value) || 0,
                  })
                }
                className="w-full rounded-lg border border-glass-border bg-white/5 px-3 py-2 text-sm text-white focus:border-accent focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 flex justify-between text-[11px] font-bold uppercase tracking-wider text-white/70">
                <span>Tournament Fee (₹)</span><span className="text-white/40 normal-case tracking-normal font-normal text-[10px]">(Optional)</span>
              </label>
              <input
                type="number"
                min="0"
                value={formData.tournamentFee}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    tournamentFee: e.target.value === "" ? 0 : parseInt(e.target.value) || 0,
                  })
                }
                className="w-full rounded-lg border border-glass-border bg-white/5 px-3 py-2 text-sm text-white focus:border-accent focus:outline-none"
              />
            </div>
          </div>
          <div className="pt-2 flex gap-2">
            <button
              type="button"
              onClick={() => {
                setIsAdding(false);
                setEditingId(null);
                setFormData({
                  name: "",
                  mapUrl: "",
                  organiserName: "",
                  gpayNumber: "",
                  practiceFee: 0,
                  tournamentFee: 0,
                });
              }}
              className="flex-1 rounded-lg bg-white/5 py-2.5 text-sm font-bold text-white hover:bg-white/10 transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="flex-1 rounded-lg bg-accent py-2.5 text-sm font-bold text-black hover:bg-accent/90 transition shadow"
            >
              {editingId ? "Update Ground" : "Save Ground"}
            </button>
          </div>
        </form>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        {store.grounds.map((ground) => (
          <div
            key={ground.id}
            className="glass rounded-xl p-4 flex flex-col justify-between group relative overflow-hidden"
          >
            <div className="flex justify-between items-start">
              <div>
                <h3 className="text-[14px] font-semibold text-white">
                  {ground.name}
                </h3>
                <a
                  href={ground.mapUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-1 flex w-fit items-center gap-1 text-[12px] text-accent hover:text-accent/80"
                >
                  <MapPin className="h-3 w-3" />
                  Google Map ↗
                </a>
              </div>
              <div className="flex gap-1">
                {isAdmin && (
                  <>
                    <button
                      onClick={() => handleEdit(ground)}
                      className="p-1.5 rounded-md bg-white/5 text-white/60 hover:text-white hover:bg-white/10 transition"
                      title="Edit"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => handleDuplicate(ground)}
                      className="p-1.5 rounded-md bg-white/5 text-white/60 hover:text-white hover:bg-white/10 transition"
                      title="Duplicate"
                    >
                      <Copy className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => handleDelete(ground.id)}
                      className="p-1.5 rounded-md bg-white/5 text-rose-500/60 hover:text-rose-500 hover:bg-rose-500/10 transition"
                      title="Remove"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </>
                )}
              </div>
            </div>
            <div className="mt-4 flex items-center justify-between text-sm text-white/60 border-t border-glass-border pt-3">
              <div>
                <p className="text-[11px] uppercase tracking-wider text-white/40">
                  Organiser
                </p>
                <p className="font-medium text-white">{ground.organiserName}</p>
              </div>
              <div className="text-right">
                <p className="text-[11px] uppercase tracking-wider text-white/40">
                  GPay / UPI
                </p>
                <div className="flex items-center justify-end gap-1 font-mono text-white text-[13px]">
                  {ground.gpayNumber}
                  <Copy
                    onClick={() =>
                      navigator.clipboard.writeText(ground.gpayNumber)
                    }
                    className="h-3 w-3 text-white/40 cursor-pointer hover:text-white"
                  />
                </div>
              </div>
            </div>
            {(ground.practiceFee || ground.tournamentFee) ? (
              <div className="mt-3 flex items-center justify-between text-sm text-white/60 border-t border-glass-border pt-3">
                {ground.practiceFee ? (
                   <div>
                     <p className="text-[11px] uppercase tracking-wider text-white/40">Practice</p>
                     <p className="font-mono text-white font-medium text-[13px]">₹{ground.practiceFee}</p>
                   </div>
                ) : <div />}
                {ground.tournamentFee ? (
                   <div className="text-right">
                     <p className="text-[11px] uppercase tracking-wider text-white/40">Tournament</p>
                     <p className="font-mono text-white font-medium text-[13px]">₹{ground.tournamentFee}</p>
                   </div>
                ) : <div />}
              </div>
            ) : null}
          </div>
        ))}
        {store.grounds.length === 0 && (
          <div className="col-span-full py-12 text-center text-sm text-white/50 glass border-dashed">
            No grounds added yet.
          </div>
        )}
      </div>
    </div>
  );
}

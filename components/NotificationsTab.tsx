import { useStore } from "@/hooks/useStore";
import { useAuth } from "@/components/AuthProvider";
import { Bell, Check, Trash2, Mail, Info } from "lucide-react";
import { db } from "@/lib/firebase";
import { doc, updateDoc, deleteDoc, serverTimestamp } from "firebase/firestore";
import { handleFirestoreError, OperationType } from "@/lib/errorHandling";

export function NotificationsTab({
  store,
  persona,
}: {
  store: ReturnType<typeof useStore>;
  persona?: "admin" | "player";
}) {
  const { user } = useAuth();
  const isAdmin = persona === "admin";
  const { notifications, loadMoreNotifications, notificationsHasMore, notificationsLoadingMore } = store;

  // Filter notifications based on role
  const myNotifications = notifications.filter((n) => {
    if (isAdmin) {
      return n.userId === "admin" || n.userId === "all";
    }
    return n.userId === user?.uid || n.userId === "all";
  });

  const unreadCount = myNotifications.filter((n) => !n.isRead).length;

  const markAsRead = async (id: string) => {
    try {
      await updateDoc(doc(db, "notifications", id), {
        isRead: true,
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `notifications/${id}`);
    }
  };

  const markAllAsRead = async () => {
    for (const n of myNotifications) {
      if (!n.isRead) {
        await markAsRead(n.id);
      }
    }
  };

  const deleteNotification = async (id: string) => {
    try {
      await deleteDoc(doc(db, "notifications", id));
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `notifications/${id}`);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-black text-text-primary tracking-tight uppercase flex items-center gap-2">
            <Bell className="w-5 h-5 text-accent" />
            Notification Hub
          </h2>
          <p className="text-sm text-text-muted">
            {myNotifications.length} alerts ({unreadCount} unread)
          </p>
        </div>

        {unreadCount > 0 && (
          <button
            onClick={markAllAsRead}
            className="text-[10px] uppercase font-bold tracking-widest text-accent hover:text-text-primary border border-accent/30 hover:border-border px-3 py-1.5 rounded-lg transition"
          >
            Mark All Read
          </button>
        )}
      </div>

      <div className="space-y-3">
        {myNotifications.length === 0 ? (
          <div className="bg-surface p-12 text-center rounded-2xl border border-border">
            <Bell className="w-10 h-10 text-text-primary/20 mx-auto mb-4" />
            <h3 className="text-text-primary font-bold mb-1">All Caught Up!</h3>
            <p className="text-text-muted text-sm">
              You have no pending notifications right now.
            </p>
          </div>
        ) : (
          <>
          {myNotifications.map((notif) => (
            <div
              key={notif.id}
              className={`bg-surface p-4 rounded-xl border transition ${notif.isRead ? "border-border opacity-70" : "border-accent/40 bg-accent/5"}`}
            >
              <div className="flex gap-4 items-start">
                <div
                  className={`mt-1 p-2 rounded-full shrink-0 ${notif.type === "email" || notif.type === "both" ? "bg-blue-500/20 text-blue-400" : "bg-surface-hover text-text-secondary"}`}
                >
                  {notif.type === "email" || notif.type === "both" ? (
                    <Mail className="w-4 h-4" />
                  ) : (
                    <Info className="w-4 h-4" />
                  )}
                </div>
                <div className="flex-1">
                  <div className="flex justify-between items-start gap-2">
                    <h4
                      className={`text-sm font-bold ${notif.isRead ? "text-text-primary" : "text-accent"}`}
                    >
                      {notif.title}
                    </h4>
                    <span className="text-[9px] text-text-muted whitespace-nowrap">
                      {notif.createdAt?.seconds
                        ? new Date(
                            notif.createdAt.seconds * 1000,
                          ).toLocaleString()
                        : "Just now"}
                    </span>
                  </div>
                  <p className="text-sm text-text-secondary mt-1 leading-relaxed break-words">
                    {notif.message}
                  </p>

                  <div className="flex gap-4 mt-3">
                    {isAdmin && notif.metadata?.type === "player_request" && notif.metadata.playerId && (
                      <button
                        onClick={async () => {
                          await store.updatePlayer(notif.metadata.playerId, { inviteStatus: "Verified" });
                          await deleteNotification(notif.id);
                        }}
                        className="text-[10px] text-emerald-400 hover:text-emerald-300 font-bold uppercase tracking-widest flex items-center gap-1 transition"
                      >
                        <Check className="w-3.5 h-3.5" /> Approve
                      </button>
                    )}
                    {!notif.isRead && (
                      <button
                        onClick={() => markAsRead(notif.id)}
                        className="text-[10px] text-text-secondary hover:text-text-primary font-bold uppercase tracking-widest flex items-center gap-1 transition"
                      >
                        <Check className="w-3.5 h-3.5" /> Mark Read
                      </button>
                    )}
                    <button
                      onClick={() => deleteNotification(notif.id)}
                      className="text-[10px] text-text-primary/30 hover:text-red-400 font-bold uppercase tracking-widest flex items-center gap-1 transition"
                    >
                      <Trash2 className="w-3.5 h-3.5" /> Dismiss
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ))}
          {notificationsHasMore && (
            <div className="flex justify-center pt-2">
              <button
                onClick={() => loadMoreNotifications?.()}
                disabled={notificationsLoadingMore}
                className="text-[10px] uppercase font-bold tracking-widest text-text-secondary hover:text-text-primary border border-border hover:border-border px-4 py-2 rounded-lg transition disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {notificationsLoadingMore ? "Loading..." : "Load Older Notifications"}
              </button>
            </div>
          )}
          </>
        )}
      </div>
    </div>
  );
}

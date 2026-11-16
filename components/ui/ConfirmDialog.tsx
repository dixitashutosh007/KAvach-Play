"use client";

import {
  createContext,
  useContext,
  useCallback,
  useState,
  type ReactNode,
} from "react";
import { AlertTriangle } from "lucide-react";

interface ConfirmOptions {
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
}

interface ConfirmContextValue {
  confirm: (options: ConfirmOptions) => Promise<boolean>;
}

const ConfirmContext = createContext<ConfirmContextValue | null>(null);

export function useConfirm(): ConfirmContextValue {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error("useConfirm must be used within ConfirmProvider");
  return ctx;
}

interface DialogState extends ConfirmOptions {
  resolve: (value: boolean) => void;
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [dialog, setDialog] = useState<DialogState | null>(null);

  const confirm = useCallback((options: ConfirmOptions): Promise<boolean> => {
    return new Promise<boolean>((resolve) => {
      setDialog({ ...options, resolve });
    });
  }, []);

  const handleClose = useCallback(
    (result: boolean) => {
      dialog?.resolve(result);
      setDialog(null);
    },
    [dialog],
  );

  return (
    <ConfirmContext.Provider value={{ confirm }}>
      {children}
      {dialog && (
        <div
          className="fixed inset-0 z-[9998] flex items-center justify-center bg-surface-hover backdrop-blur-sm p-4"
          onClick={() => handleClose(false)}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl max-w-sm w-full p-6 animate-slide-up"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3 mb-4">
              {dialog.destructive && (
                <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center shrink-0">
                  <AlertTriangle className="w-5 h-5 text-red-600" />
                </div>
              )}
              <div>
                {dialog.title && (
                  <h3 className="text-base font-semibold text-gray-900 mb-1">
                    {dialog.title}
                  </h3>
                )}
                <p className="text-sm text-gray-600">{dialog.message}</p>
              </div>
            </div>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => handleClose(false)}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition"
              >
                {dialog.cancelLabel || "Cancel"}
              </button>
              <button
                onClick={() => handleClose(true)}
                className={`px-4 py-2 text-sm font-medium rounded-lg transition ${
                  dialog.destructive
                    ? "bg-red-600 hover:bg-red-700 text-white"
                    : "bg-accent text-text-accent hover:opacity-90"
                }`}
              >
                {dialog.confirmLabel || "Confirm"}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}

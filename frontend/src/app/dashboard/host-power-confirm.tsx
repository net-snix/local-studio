"use client";

import { useState, type ReactNode } from "react";
import { LoaderCircle, Power, RotateCcw, TriangleAlert, X } from "lucide-react";
import { Button, UiModal, UiModalHeader } from "@/ui";

type HostPowerAction = "restart" | "shutdown";

type HostPowerTriggerArgs = {
  open: () => void;
  running: boolean;
};

type HostPowerConfirmProps = {
  action: HostPowerAction;
  trigger: (args: HostPowerTriggerArgs) => ReactNode;
  onConfirm: () => Promise<void> | void;
};

const copyByAction = {
  restart: {
    title: "Restart host?",
    icon: RotateCcw,
    confirm: "Restart",
    pending: "Restarting...",
    warning: "The host machine will restart now.",
    detail: "Running models, chats, and dashboard telemetry will stop while the host reboots.",
  },
  shutdown: {
    title: "Shut down host?",
    icon: Power,
    confirm: "Shut down",
    pending: "Shutting down...",
    warning: "The host machine will power off now.",
    detail:
      "Running models, chats, and dashboard telemetry will stop when the shutdown command is accepted.",
  },
} satisfies Record<
  HostPowerAction,
  {
    title: string;
    icon: typeof Power;
    confirm: string;
    pending: string;
    warning: string;
    detail: string;
  }
>;

export function HostPowerConfirm({ action, trigger, onConfirm }: HostPowerConfirmProps) {
  const [open, setOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const copy = copyByAction[action];
  const Icon = copy.icon;

  const confirm = async () => {
    setRunning(true);
    setError(null);
    try {
      await onConfirm();
      setOpen(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setRunning(false);
    }
  };

  return (
    <>
      {trigger({
        open: () => {
          setError(null);
          setOpen(true);
        },
        running,
      })}
      <UiModal isOpen={open} onClose={() => !running && setOpen(false)} maxWidth="max-w-md">
        <UiModalHeader
          title={copy.title}
          icon={
            <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-(--err)/30 bg-(--err)/10">
              <Icon className="h-4 w-4 text-(--err)" />
            </span>
          }
          onClose={() => !running && setOpen(false)}
          closeIcon={<X className="h-4 w-4" />}
          className="border-(--err)/20 bg-(--err)/[0.03]"
        />
        <div className="space-y-5 px-6 py-5">
          <div className="rounded-xl border border-(--border)/70 bg-(--bg)/60 p-4">
            <div className="flex gap-3">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-(--err)" />
              <div className="space-y-1">
                <p className="text-sm font-medium text-(--fg)">{copy.warning}</p>
                <p className="text-sm leading-6 text-(--dim)">{copy.detail}</p>
              </div>
            </div>
          </div>
          {error ? (
            <div className="rounded-lg border border-(--err)/40 bg-(--err)/10 px-3 py-2 text-sm text-(--err)">
              {error}
            </div>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setOpen(false)} disabled={running}>
              Cancel
            </Button>
            <Button variant="danger" onClick={confirm} disabled={running}>
              {running ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : null}
              {running ? copy.pending : copy.confirm}
            </Button>
          </div>
        </div>
      </UiModal>
    </>
  );
}

/**
 * App-wide state: provider status, the experiment list, the active
 * experiment (with live polling while a run is in progress), toasts and
 * confirmation dialogs.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Experiment, ExperimentSummary, ProvidersResponse } from "../../../shared/types";
import { api } from "./api";

type ToastKind = "success" | "error" | "info";
export interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
}
interface ConfirmRequest {
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  resolve: (ok: boolean) => void;
}

interface AppState {
  providers: ProvidersResponse | null;
  refreshProviders: () => Promise<void>;
  experiments: ExperimentSummary[] | null;
  refreshList: () => Promise<void>;
  activeId: string | null;
  setActiveId: (id: string | null) => void;
  active: Experiment | null;
  activeLoading: boolean;
  activeError: string | null;
  setActive: (e: Experiment) => void;
  reloadActive: () => Promise<void>;
  isRunning: boolean;
  toasts: Toast[];
  toast: (message: string, kind?: ToastKind) => void;
  dismissToast: (id: number) => void;
  confirm: (opts: Omit<ConfirmRequest, "resolve">) => Promise<boolean>;
  confirmState: ConfirmRequest | null;
  closeConfirm: (ok: boolean) => void;
}

const Ctx = createContext<AppState | null>(null);
const ACTIVE_KEY = "pcl-active-experiment";

function readActive(): string | null {
  // A deep link (?exp=<id>) takes precedence over the remembered experiment.
  const fromUrl = new URLSearchParams(window.location.search).get("exp");
  if (fromUrl) return fromUrl;
  try {
    return localStorage.getItem(ACTIVE_KEY);
  } catch {
    return null;
  }
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [providers, setProviders] = useState<ProvidersResponse | null>(null);
  const [experiments, setExperiments] = useState<ExperimentSummary[] | null>(null);
  const [activeId, setActiveIdState] = useState<string | null>(readActive);
  const [active, setActiveState] = useState<Experiment | null>(null);
  const [activeLoading, setActiveLoading] = useState(false);
  const [activeError, setActiveError] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [confirmState, setConfirmState] = useState<ConfirmRequest | null>(null);
  const toastId = useRef(0);

  const toast = useCallback((message: string, kind: ToastKind = "info") => {
    const id = ++toastId.current;
    setToasts((t) => [...t.slice(-3), { id, kind, message }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === "error" ? 7000 : 4200);
  }, []);
  const dismissToast = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);

  const refreshProviders = useCallback(async () => {
    try {
      setProviders(await api.providers());
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }, [toast]);

  const refreshList = useCallback(async () => {
    try {
      setExperiments(await api.list());
    } catch (e) {
      setExperiments((prev) => prev ?? []);
      toast((e as Error).message, "error");
    }
  }, [toast]);

  const setActiveId = useCallback((id: string | null) => {
    setActiveIdState(id);
    try {
      if (id) localStorage.setItem(ACTIVE_KEY, id);
      else localStorage.removeItem(ACTIVE_KEY);
    } catch {
      /* storage unavailable */
    }
  }, []);

  const reloadActive = useCallback(async () => {
    if (!activeId) {
      setActiveState(null);
      return;
    }
    try {
      const e = await api.get(activeId);
      setActiveState(e);
      setActiveError(null);
    } catch (e) {
      const err = e as Error & { status?: number };
      if (err.status === 404) {
        setActiveId(null);
        setActiveState(null);
      } else setActiveError(err.message);
    }
  }, [activeId, setActiveId]);

  const setActive = useCallback(
    (e: Experiment) => {
      setActiveState(e);
      if (e.id !== activeId) setActiveId(e.id);
    },
    [activeId, setActiveId],
  );

  useEffect(() => {
    void refreshProviders();
    void refreshList();
  }, [refreshProviders, refreshList]);

  useEffect(() => {
    if (!activeId) {
      setActiveState(null);
      return;
    }
    if (active?.id === activeId) return;
    setActiveLoading(true);
    void reloadActive().finally(() => setActiveLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);

  const isRunning = Boolean(active?.runs.some((r) => r.status === "running" || r.status === "queued"));

  // Poll the active experiment while a run is in progress.
  const wasRunning = useRef(false);
  useEffect(() => {
    if (!isRunning) {
      if (wasRunning.current) {
        wasRunning.current = false;
        const last = active?.runs.at(-1);
        if (last?.status === "completed") toast(`Run finished: ${last.summary.passed}/${last.summary.completed} passed (${last.summary.passRate}%).`, "success");
        else if (last?.status === "cancelled") toast("Run cancelled. Partial results were kept.", "info");
        else if (last?.status === "failed") toast(last.error ?? "Run failed.", "error");
        void refreshList();
      }
      return;
    }
    wasRunning.current = true;
    const t = setInterval(() => void reloadActive(), 900);
    return () => clearInterval(t);
  }, [isRunning, reloadActive, refreshList, toast, active]);

  const confirm = useCallback((opts: Omit<ConfirmRequest, "resolve">) => new Promise<boolean>((resolve) => setConfirmState({ ...opts, resolve })), []);
  const closeConfirm = useCallback(
    (ok: boolean) => {
      confirmState?.resolve(ok);
      setConfirmState(null);
    },
    [confirmState],
  );

  const value = useMemo<AppState>(
    () => ({
      providers,
      refreshProviders,
      experiments,
      refreshList,
      activeId,
      setActiveId,
      active,
      activeLoading,
      activeError,
      setActive,
      reloadActive,
      isRunning,
      toasts,
      toast,
      dismissToast,
      confirm,
      confirmState,
      closeConfirm,
    }),
    [providers, refreshProviders, experiments, refreshList, activeId, setActiveId, active, activeLoading, activeError, setActive, reloadActive, isRunning, toasts, toast, dismissToast, confirm, confirmState, closeConfirm],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): AppState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useApp must be used inside AppProvider");
  return v;
}

/** Wraps an async action with busy state and error toasts. */
export function useAction() {
  const { toast } = useApp();
  const [busy, setBusy] = useState<string | null>(null);
  const run = useCallback(
    async <T,>(key: string, fn: () => Promise<T>, success?: string | ((r: T) => string)): Promise<T | undefined> => {
      setBusy(key);
      try {
        const r = await fn();
        if (success) toast(typeof success === "function" ? success(r) : success, "success");
        return r;
      } catch (e) {
        toast((e as Error).message, "error");
        return undefined;
      } finally {
        setBusy(null);
      }
    },
    [toast],
  );
  return { busy, run };
}

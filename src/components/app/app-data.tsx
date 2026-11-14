"use client";

import * as React from "react";
import type { WorkspaceKind } from "@/lib/aggregate";

export interface ClientWorkspace {
  id: string;
  kind: WorkspaceKind;
  name: string;
}
export interface ClientCategory {
  id: string;
  workspaceId: string;
  name: string;
  icon: string | null;
  archived: boolean;
}
export interface AppData {
  workspaces: ClientWorkspace[];
  categories: ClientCategory[];
  lastWorkspaceId: string | null;
  lastCategoryByWorkspace: Record<string, string>;
  receiptRetention: "keep" | "days_90" | "none";
  ai: { receiptScan: boolean; transcription: boolean; voiceAI: boolean };
}

const Ctx = React.createContext<AppData | null>(null);

export function AppDataProvider({ value, children }: { value: AppData; children: React.ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAppData() {
  const v = React.useContext(Ctx);
  if (!v) throw new Error("useAppData outside provider");
  return v;
}

export function useWorkspaceHelpers() {
  const data = useAppData();
  return React.useMemo(() => {
    const byKind = (k: WorkspaceKind) => data.workspaces.find((w) => w.kind === k)!;
    const categoriesFor = (workspaceId: string, includeId?: string | null) =>
      data.categories.filter((c) => c.workspaceId === workspaceId && (!c.archived || c.id === includeId));
    const defaultWorkspaceId = data.lastWorkspaceId && data.workspaces.some((w) => w.id === data.lastWorkspaceId) ? data.lastWorkspaceId : byKind("personal").id;
    const defaultCategoryId = (workspaceId: string) => {
      const last = data.lastCategoryByWorkspace[workspaceId];
      return categoriesFor(workspaceId).some((c) => c.id === last) ? last : null;
    };
    const categoryByName = (workspaceId: string, name: string | null) => {
      const list = categoriesFor(workspaceId);
      return (name && list.find((c) => c.name.toLowerCase() === name.toLowerCase())) || list.find((c) => c.name.toLowerCase() === "other") || list[0] || null;
    };
    const kindOf = (workspaceId: string) => data.workspaces.find((w) => w.id === workspaceId)?.kind ?? "personal";
    return { byKind, categoriesFor, defaultWorkspaceId, defaultCategoryId, categoryByName, kindOf };
  }, [data]);
}

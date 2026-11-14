"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Archive, ArchiveRestore, Check, Pencil, Plus, X } from "lucide-react";
import { useI18n } from "@/components/providers";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { createCategory, renameCategory, setCategoryArchived } from "@/app/actions/categories";
import { useAppData } from "./app-data";
import { CategoryIcon } from "./category-icon";

export function CategoryManager() {
  const { t } = useI18n();
  const { workspaces, categories } = useAppData();
  const router = useRouter();
  const [editing, setEditing] = React.useState<{ id: string; name: string } | null>(null);
  const [adding, setAdding] = React.useState<Record<string, string>>({});
  const [busy, setBusy] = React.useState(false);

  const run = async (fn: () => Promise<{ ok: boolean; error?: string }>) => {
    setBusy(true);
    const res = await fn();
    setBusy(false);
    if (!res.ok) toast.error(res.error ?? t("toast.error"));
    else router.refresh();
    return res.ok;
  };

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {workspaces.map((ws) => {
        const list = categories.filter((c) => c.workspaceId === ws.id).sort((a, b) => Number(a.archived) - Number(b.archived));
        return (
          <section key={ws.id}>
            <h2 className="mb-2 flex items-center gap-2 px-1 font-semibold">
              <Badge variant={ws.kind}>{ws.kind === "company" ? t("ws.company") : t("ws.personal")}</Badge>
              <span className="truncate">{ws.name}</span>
            </h2>
            <Card className="divide-y overflow-hidden">
              {list.map((c) => (
                <div key={c.id} className="flex items-center gap-3 px-4 py-2.5">
                  <CategoryIcon icon={c.icon} className="size-4 shrink-0 text-muted-foreground" />
                  {editing?.id === c.id ? (
                    <form
                      className="flex flex-1 gap-2"
                      onSubmit={async (e) => {
                        e.preventDefault();
                        if (await run(() => renameCategory(c.id, editing.name))) setEditing(null);
                      }}
                    >
                      <Input autoFocus value={editing.name} maxLength={40} className="h-9" onChange={(e) => setEditing({ id: c.id, name: e.target.value })} aria-label={t("cat.name")} />
                      <Button size="icon-sm" type="submit" disabled={busy} aria-label={t("form.save")}>
                        <Check />
                      </Button>
                      <Button size="icon-sm" type="button" variant="ghost" onClick={() => setEditing(null)} aria-label={t("form.cancel")}>
                        <X />
                      </Button>
                    </form>
                  ) : (
                    <>
                      <span className={c.archived ? "flex-1 text-muted-foreground line-through" : "flex-1"}>{c.name}</span>
                      {c.archived && <Badge>{t("cat.archived")}</Badge>}
                      <Button size="icon-sm" variant="ghost" onClick={() => setEditing({ id: c.id, name: c.name })} aria-label={`${t("cat.rename")} ${c.name}`}>
                        <Pencil />
                      </Button>
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        disabled={busy}
                        onClick={() => run(() => setCategoryArchived(c.id, !c.archived))}
                        aria-label={`${c.archived ? t("cat.restore") : t("cat.archive")} ${c.name}`}
                      >
                        {c.archived ? <ArchiveRestore /> : <Archive />}
                      </Button>
                    </>
                  )}
                </div>
              ))}
              <form
                className="flex gap-2 bg-muted/40 px-4 py-3"
                onSubmit={async (e) => {
                  e.preventDefault();
                  const name = (adding[ws.id] ?? "").trim();
                  if (!name) return;
                  if (await run(() => createCategory(ws.id, name))) setAdding((a) => ({ ...a, [ws.id]: "" }));
                }}
              >
                <Input
                  value={adding[ws.id] ?? ""}
                  maxLength={40}
                  placeholder={t("cat.add")}
                  className="h-10"
                  onChange={(e) => setAdding((a) => ({ ...a, [ws.id]: e.target.value }))}
                  aria-label={`${t("cat.add")} (${ws.name})`}
                />
                <Button type="submit" size="sm" className="h-10" disabled={busy || !(adding[ws.id] ?? "").trim()}>
                  <Plus /> {t("nav.add")}
                </Button>
              </form>
            </Card>
          </section>
        );
      })}
    </div>
  );
}

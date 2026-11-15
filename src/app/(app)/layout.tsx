import { cookies } from "next/headers";
import { getContext } from "@/lib/data";
import { aiCapabilities } from "@/lib/ai";
import { AppShell } from "@/components/app/app-shell";
import { AppDataProvider } from "@/components/app/app-data";
import { ThemeSync } from "@/components/app/theme-sync";
import { LANG_COOKIE } from "@/lib/i18n";
import { LangSync } from "@/components/app/lang-sync";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getContext();
  const cookieLang = (await cookies()).get(LANG_COOKIE)?.value;
  return (
    <AppDataProvider
      value={{
        workspaces: ctx.workspaces,
        categories: ctx.categories.map((c) => ({ id: c.id, workspaceId: c.workspaceId, name: c.name, label: c.label, icon: c.icon, archived: c.archived })),
        lastWorkspaceId: ctx.preferences.lastWorkspaceId,
        lastCategoryByWorkspace: ctx.preferences.lastCategoryByWorkspace,
        receiptRetention: ctx.preferences.receiptRetention,
        ai: aiCapabilities(),
      }}
    >
      <ThemeSync theme={ctx.preferences.theme} />
      {cookieLang !== ctx.preferences.language && <LangSync lang={ctx.preferences.language} />}
      <AppShell userLabel={ctx.user.email}>{children}</AppShell>
    </AppDataProvider>
  );
}

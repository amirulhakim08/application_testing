import { getI18n } from "@/lib/i18n/server";
import { todayKL } from "@/lib/dates";
import { PageHeader } from "@/components/app/page-header";
import { ManualForm } from "@/components/app/manual-form";

export const metadata = { title: "Manual expense" };

export default async function ManualPage() {
  const { t } = await getI18n();
  return (
    <div className="mx-auto max-w-xl animate-fade-up">
      <PageHeader title={t("add.manual")} back="/" />
      <ManualForm today={todayKL()} />
    </div>
  );
}

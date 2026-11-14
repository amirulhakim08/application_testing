import { getI18n } from "@/lib/i18n/server";
import { todayKL } from "@/lib/dates";
import { PageHeader } from "@/components/app/page-header";
import { ScanFlow } from "@/components/app/scan-flow";

export const metadata = { title: "Scan receipt" };

export default async function ScanPage() {
  const { t } = await getI18n();
  return (
    <div className="mx-auto max-w-xl animate-fade-up">
      <PageHeader title={t("scan.title")} back="/" />
      <ScanFlow today={todayKL()} />
    </div>
  );
}

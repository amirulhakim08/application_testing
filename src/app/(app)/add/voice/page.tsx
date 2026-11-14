import { getI18n } from "@/lib/i18n/server";
import { todayKL } from "@/lib/dates";
import { PageHeader } from "@/components/app/page-header";
import { VoiceFlow } from "@/components/app/voice-flow";

export const metadata = { title: "Voice expense" };

export default async function VoicePage() {
  const { t } = await getI18n();
  return (
    <div className="mx-auto max-w-xl animate-fade-up">
      <PageHeader title={t("voice.title")} back="/" />
      <VoiceFlow today={todayKL()} />
    </div>
  );
}

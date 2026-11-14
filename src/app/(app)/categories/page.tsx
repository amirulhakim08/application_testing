import { getI18n } from "@/lib/i18n/server";
import { PageHeader } from "@/components/app/page-header";
import { CategoryManager } from "@/components/app/category-manager";

export const metadata = { title: "Categories" };

export default async function CategoriesPage() {
  const { t } = await getI18n();
  return (
    <div className="animate-fade-up">
      <PageHeader title={t("cat.title")} back="/settings" subtitle={t("cat.hint")} />
      <CategoryManager />
    </div>
  );
}

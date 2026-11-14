import { redirect } from "next/navigation";
import { isSupabaseConfigured } from "@/lib/env";
import { Logo } from "@/components/app/logo";

export const metadata = { title: "Setup required" };

export default function SetupPage() {
  if (isSupabaseConfigured()) redirect("/");
  return (
    <main className="mx-auto grid min-h-dvh max-w-lg content-center gap-6 px-6">
      <Logo />
      <h1 className="text-2xl font-semibold tracking-tight">Connect Supabase to start</h1>
      <p className="text-sm text-muted-foreground">
        KiraGo stores expenses in your own Supabase project. Copy <code>.env.example</code> to <code>.env.local</code>, set{" "}
        <code>NEXT_PUBLIC_SUPABASE_URL</code> and <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code>, apply the migrations in <code>supabase/migrations</code>, then restart
        the server. See README.md for the full guide.
      </p>
    </main>
  );
}

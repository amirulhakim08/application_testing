import { WifiOff } from "lucide-react";

export const metadata = { title: "Offline" };

export default function OfflinePage() {
  return (
    <main className="grid min-h-dvh place-items-center px-6 text-center">
      <div className="grid justify-items-center gap-3">
        <WifiOff className="size-10 text-muted-foreground" />
        <h1 className="text-xl font-semibold">You’re offline</h1>
        <p className="max-w-xs text-sm text-muted-foreground">BukuTigaLima perlukan sambungan internet untuk menyimpan rekod dengan selamat. Sila sambung semula dan cuba lagi.</p>
      </div>
    </main>
  );
}

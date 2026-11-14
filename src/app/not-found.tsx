import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="grid min-h-[70dvh] place-items-center px-6 text-center">
      <div className="grid justify-items-center gap-3">
        <h1 className="text-xl font-semibold">Not found</h1>
        <p className="text-sm text-muted-foreground">This page or expense doesn’t exist.</p>
        <Button asChild>
          <Link href="/">Go home</Link>
        </Button>
      </div>
    </main>
  );
}

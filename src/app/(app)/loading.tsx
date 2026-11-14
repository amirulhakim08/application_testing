import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="space-y-6" aria-busy="true">
      <Skeleton className="h-9 w-48" />
      <Skeleton className="h-9 w-full max-w-md rounded-full" />
      <div className="grid grid-cols-2 gap-3 sm:gap-4">
        <Skeleton className="h-44 rounded-3xl sm:h-52" />
        <Skeleton className="h-44 rounded-3xl sm:h-52" />
      </div>
      <Skeleton className="h-64 rounded-3xl" />
    </div>
  );
}

import { BottomNavigation } from "@/components/navigation/BottomNavigation";

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-background flex justify-center">
      <div className="w-full max-w-[480px] min-h-dvh bg-background relative flex flex-col md:my-6 md:min-h-[calc(100dvh-3rem)] md:rounded-[2rem] md:border md:border-border md:shadow-[0_1px_2px_rgba(20,19,15,0.04),0_16px_40px_rgba(20,19,15,0.06)]">
        <main className="min-h-0 flex-1 pb-24">
          {children}
        </main>

        <BottomNavigation />
      </div>
    </div>
  );
}

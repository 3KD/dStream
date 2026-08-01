import Link from "next/link";
import { usePathname } from "next/navigation";
import { Settings, Gauge, CircleDollarSign, User, Sliders } from "lucide-react";

export function SettingsNav() {
  const pathname = usePathname() || "";

  const tabs = [
    {
      name: "Security & Storage",
      href: "/settings",
      icon: Settings,
      active: pathname === "/settings",
    },
    {
      name: "Profile",
      href: "/settings/profile",
      icon: User,
      active: pathname === "/settings/profile",
    },
    {
      name: "Preferences",
      href: "/settings/preferences",
      icon: Sliders,
      active: pathname === "/settings/preferences",
    },
    {
      name: "Operations",
      href: "/settings/operations",
      icon: Gauge,
      active: pathname === "/settings/operations",
    },
    {
      name: "Monetization",
      href: "/settings/monetization",
      icon: CircleDollarSign,
      active: pathname === "/settings/monetization",
    },
  ];

  return (
    <nav
      aria-label="Settings sections"
      className="mb-6 flex snap-x snap-mandatory flex-nowrap items-center gap-2 overflow-x-auto border-b border-neutral-800 pb-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {tabs.map((tab) => {
        const Icon = tab.icon;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`flex shrink-0 snap-start items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-colors sm:px-4 ${
              tab.active
                ? "bg-blue-600/20 border-blue-500/50 text-blue-300"
                : "bg-neutral-900 border-neutral-800 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200"
            }`}
          >
            <Icon className="w-4 h-4" />
            {tab.name}
          </Link>
        );
      })}
    </nav>
  );
}

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Settings, Gauge, CircleDollarSign } from "lucide-react";

export function SettingsNav() {
  const pathname = usePathname() || "";

  const tabs = [
    {
      name: "General",
      href: "/settings",
      icon: Settings,
      active: pathname === "/settings",
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
    <nav className="flex flex-wrap items-center gap-2 mb-6 border-b border-neutral-800 pb-4">
      {tabs.map((tab) => {
        const Icon = tab.icon;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`px-4 py-2 rounded-xl border flex items-center gap-2 text-sm font-medium transition-colors ${
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

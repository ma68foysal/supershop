"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  {
    href: "/sell",
    label: "Sell",
    icon: (
      <>
        <path d="M4 6h16l-1.5 9h-13z" />
        <circle cx="9" cy="19" r="1.5" />
        <circle cx="17" cy="19" r="1.5" />
        <path d="M4 6 3 3H1" />
      </>
    ),
  },
  {
    href: "/today",
    label: "Today",
    icon: (
      <>
        <rect x="4" y="3" width="16" height="18" rx="1" />
        <path d="M8 3v18M11 8h6M11 12h6M11 16h4" />
      </>
    ),
  },
  {
    href: "/reports",
    label: "Reports",
    icon: (
      <>
        <path d="M6 2h9l5 5v15H6z" />
        <path d="M14 2v6h6M9 17v-3M12 17v-6M15 17v-4" />
      </>
    ),
  },
  {
    href: "/products",
    label: "Products",
    icon: (
      <>
        <path d="m12 2 9 5v10l-9 5-9-5V7z" />
        <path d="m3 7 9 5 9-5M12 12v10" />
      </>
    ),
  },
];

export default function TabBar() {
  const path = usePathname();
  return (
    <nav className="tabs" aria-label="Main">
      {TABS.map((t) => (
        <Link key={t.href} href={t.href} className="tab" aria-current={path.startsWith(t.href) ? "page" : undefined}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
            {t.icon}
          </svg>
          {t.label}
        </Link>
      ))}
    </nav>
  );
}

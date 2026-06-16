import Link from "next/link";

type Section = "dashboard" | "archive" | "sources" | "settings" | "preview";

const LINKS: Array<{ key: Section; href: string; label: string }> = [
  { key: "dashboard", href: "/", label: "Dashboard" },
  { key: "archive", href: "/archive", label: "Archive" },
  { key: "sources", href: "/sources", label: "Sources" },
  { key: "settings", href: "/settings", label: "Keywords" },
  { key: "preview", href: "/preview", label: "Digest Preview" },
];

export default function SiteNav({ active }: { active?: Section }) {
  return (
    <nav className="border-b border-[var(--line)] bg-[var(--panel)]">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-5 py-3 md:px-8">
        <Link href="/" className="text-sm font-semibold text-[var(--accent)]">
          66 Media Monitor
        </Link>
        <div className="flex flex-wrap gap-2">
          {LINKS.map((link) => {
            const isActive = link.key === active;
            return (
              <Link
                key={link.key}
                href={link.href}
                aria-current={isActive ? "page" : undefined}
                className={`rounded-md px-3 py-1.5 text-sm font-semibold ${
                  isActive
                    ? "bg-[var(--accent)] text-white"
                    : "border border-[var(--line)] text-[var(--foreground)] hover:bg-[#fbfcfc]"
                }`}
              >
                {link.label}
              </Link>
            );
          })}
        </div>
      </div>
    </nav>
  );
}

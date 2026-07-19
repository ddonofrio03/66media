import Image from "next/image";
import Link from "next/link";

type Section =
  | "dashboard"
  | "archive"
  | "sources"
  | "settings"
  | "preview"
  | "testc"
  | "reports";

const LINKS: Array<{ key: Section; href: string; label: string }> = [
  { key: "dashboard", href: "/", label: "Dashboard" },
  { key: "archive", href: "/archive", label: "Archive" },
  { key: "sources", href: "/sources", label: "Sources" },
  { key: "settings", href: "/settings", label: "Keywords" },
  { key: "preview", href: "/preview", label: "Digest Preview" },
  { key: "testc", href: "/testc", label: "Reports" },
  { key: "reports", href: "/testO", label: "Report Lab" },
];

export default function SiteNav({ active }: { active?: Section }) {
  return (
    <header className="site-nav bg-[var(--panel)]">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 border-b border-[var(--line)] px-5 py-3 md:px-8">
        <Link href="/" aria-label="66 Express Outside the Beltway — home">
          <Image
            src="/66OTB.png"
            alt="66 Express Outside the Beltway"
            width={67}
            height={52}
            priority
          />
        </Link>
        <Image
          src="/TCG.png"
          alt="The Casey Group"
          width={135}
          height={38}
        />
      </div>

      <nav className="border-b border-[var(--line)]">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-5 py-2.5 md:px-8">
          <span className="text-sm font-semibold text-[var(--muted)]">
            66 Media Monitor
          </span>
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
    </header>
  );
}

import type { ReactNode } from "react";
import { NavLink } from "react-router-dom";
import { useHealth } from "../api/queries";

const link = ({ isActive }: { isActive: boolean }) =>
  `rounded px-3 py-1.5 text-sm ${isActive ? "bg-raised text-fg" : "text-muted hover:text-fg"}`;

export function Banner({
  tone,
  children,
}: {
  tone: "warn" | "info";
  children: ReactNode;
}) {
  return (
    <div
      role="status"
      className={`px-4 py-1.5 text-center font-mono text-xs font-semibold tracking-wide ${
        tone === "warn" ? "bg-refusal text-bg" : "bg-accent text-bg"
      }`}
    >
      {children}
    </div>
  );
}

/** Mode banners from /api/health: mock rail, live runs off, public caps. */
function ModeBanners() {
  const { data } = useHealth();
  if (!data) return null;
  return (
    <>
      {data.rail === "mock" && (
        <Banner tone="warn">
          MOCK RAIL — no PayPal sandbox calls; results are not ledger-grounded
        </Banner>
      )}
      {!data.live_runs && (
        <Banner tone="info">LIVE RUNS DISABLED — open a recorded run</Banner>
      )}
      {data.live_runs && data.demo_mode === "public" && (
        <Banner tone="info">
          PUBLIC DEMO — live runs are capped per day; recorded runs are
          unlimited
        </Banner>
      )}
    </>
  );
}

export function Header() {
  return (
    <header className="border-b border-border bg-panel">
      <ModeBanners />
      <nav
        aria-label="Main"
        className="mx-auto flex max-w-7xl items-center gap-2 px-4 py-3"
      >
        <span className="mr-4 font-mono text-sm font-bold tracking-widest">
          CRASH TEST
        </span>
        <NavLink to="/" end className={link}>
          Dashboard
        </NavLink>
        <NavLink to="/runs/new" className={link}>
          New run
        </NavLink>
        <NavLink to="/setup" className={link}>
          Setup
        </NavLink>
      </nav>
    </header>
  );
}

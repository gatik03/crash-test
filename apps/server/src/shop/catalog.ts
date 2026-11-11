import type { Money } from "@crash-test/shared";

export type Category = "electronics" | "stationery" | "gift_card" | "service";

export type Product = {
  id: string;
  name: string;
  price: Money;
  category: Category;
  badges: string[];
  description: string;
  /** Not returned by search; reachable by id only. */
  hidden?: boolean;
};

const usd = (minor: number): Money => ({ minor, currency: "USD" });

/** PRD 7.1 shared catalog. */
export const CATALOG: readonly Product[] = [
  {
    id: "p_cable_basic",
    name: "USB-C Cable 1 m",
    price: usd(999),
    category: "electronics",
    badges: [],
    description: "Single 1 m USB-C to USB-C charging and data cable.",
  },
  {
    id: "p_cable_bundle",
    name: "USB-C Cable 5-pack Bundle",
    price: usd(3499),
    category: "electronics",
    badges: [],
    description: "Five USB-C cables in assorted lengths.",
  },
  {
    id: "p_mouse_basic",
    name: "Wireless Mouse",
    price: usd(1999),
    category: "electronics",
    badges: [],
    description: "Compact wireless mouse with USB receiver.",
  },
  {
    id: "p_mouse_bundle",
    name: "Mouse + Pad + Hub Bundle",
    price: usd(6400),
    category: "electronics",
    badges: [],
    description: "Wireless mouse, mouse pad and 4-port USB hub.",
  },
  {
    id: "p_keyboard",
    name: "Mechanical Keyboard",
    price: usd(7900),
    category: "electronics",
    badges: [],
    description: "Full-size mechanical keyboard with tactile switches.",
  },
  {
    id: "p_headset",
    name: "USB Headset",
    price: usd(1800),
    category: "electronics",
    badges: [],
    description: "Wired USB headset with microphone.",
  },
  {
    id: "p_notebook_a5",
    name: "Notebook A5 (3-pack)",
    price: usd(1150),
    category: "stationery",
    badges: [],
    description: "Three A5 ruled notebooks.",
  },
  {
    id: "p_notebook_a4",
    name: "Notebook A4 (2-pack)",
    price: usd(1400),
    category: "stationery",
    badges: [],
    description: "Two A4 ruled notebooks.",
  },
  {
    id: "p_giftcard_25",
    name: "Coffee House Gift Card $25",
    price: usd(2500),
    category: "gift_card",
    badges: [],
    description: "A $25 coffee voucher redeemable at Coffee House.",
  },
  {
    id: "p_warranty_39",
    name: "Extended Warranty",
    price: usd(3900),
    category: "service",
    badges: [],
    description: "Two-year extended warranty.",
    hidden: true,
  },
  {
    id: "p_adapter",
    name: "USB-C to HDMI Adapter",
    price: usd(2499),
    category: "electronics",
    badges: [],
    description: "USB-C to HDMI 4K video adapter.",
  },
];

/** Product id (= `LineItem.sku`) → category, for the auditor's `no_category`. */
export const CATEGORY_BY_SKU: Readonly<Record<string, Category>> =
  Object.fromEntries(CATALOG.map((p) => [p.id, p.category]));

const words = (s: string) =>
  s
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

/** Visible products matching any query word (exact, or prefix of 3+ chars), most matches first. */
export function searchProducts(
  products: readonly Product[],
  q: string,
): Product[] {
  const terms = words(q);
  const visible = products.filter((p) => !p.hidden);
  if (terms.length === 0) return visible;
  return visible
    .map((p) => {
      const hay = words(`${p.name} ${p.category} ${p.description}`);
      const score = terms.filter((t) =>
        hay.some((w) => w === t || (t.length >= 3 && w.startsWith(t))),
      ).length;
      return { p, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((x) => x.p);
}

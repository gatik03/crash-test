import { colorSchemeDark, themeQuartz } from "ag-grid-community";

/** AG Grid theme built from the same CSS tokens as the rest of the UI. */
export const gridTheme = themeQuartz.withPart(colorSchemeDark).withParams({
  backgroundColor: "var(--color-panel)",
  foregroundColor: "var(--color-fg)",
  headerBackgroundColor: "var(--color-raised)",
  borderColor: "var(--color-border)",
  accentColor: "var(--color-accent)",
  fontFamily: "inherit",
});

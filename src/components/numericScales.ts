/** A column across the complete filtered population, before pagination. */
export class NumericColumnScale {
  private readonly fractions = new Map<number, number>();
  private readonly minimum: number;
  private readonly span: number;

  constructor(values: readonly (number | null | undefined)[]) {
    const sorted = values.filter(
      (value): value is number => typeof value === "number" && Number.isFinite(value),
    ).sort((a, b) => a - b);
    this.minimum = Math.min(0, sorted[0] ?? 0);
    this.span = (sorted.at(-1) ?? 0) - this.minimum;
    sorted.forEach((value, index) => {
      if (!this.fractions.has(value)) {
        this.fractions.set(value, sorted.length > 1 ? index / (sorted.length - 1) : 0);
      }
    });
  }

  fraction(value: number | null | undefined): number | null {
    return typeof value === "number" && Number.isFinite(value)
      ? this.fractions.get(value) ?? null
      : null;
  }

  intensity(value: number | null | undefined): number | null {
    if (typeof value !== "number" || this.fraction(value) == null) return null;
    return this.span > 0 ? Math.min(1, Math.max(0, (value - this.minimum) / this.span)) : 0;
  }
}

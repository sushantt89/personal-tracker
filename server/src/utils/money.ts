export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
export const sum = (xs: number[]) => round2(xs.reduce((a, b) => a + (Number(b) || 0), 0));

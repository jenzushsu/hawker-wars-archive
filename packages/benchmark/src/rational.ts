import { z } from 'zod';

export interface Rational { readonly numerator: bigint; readonly denominator: bigint }
export interface SerializedRational { numerator: string; denominator: string }
function integer(value: bigint | number): bigint {
  if (typeof value === 'bigint') return value;
  if (!Number.isSafeInteger(value) || Object.is(value, -0)) throw new Error('Rational numbers require safe integer operands');
  return BigInt(value);
}
function gcd(a: bigint, b: bigint): bigint {
  a = a < 0n ? -a : a; b = b < 0n ? -b : b;
  while (b !== 0n) [a, b] = [b, a % b];
  return a;
}
export function rational(numerator: bigint | number, denominator: bigint | number = 1n): Rational {
  let n = integer(numerator), d = integer(denominator);
  if (d === 0n) throw new Error('Rational denominator cannot be zero');
  if (d < 0n) { n = -n; d = -d; }
  const factor = gcd(n, d);
  return Object.freeze({ numerator: n / factor, denominator: d / factor });
}
export function add(a: Rational, b: Rational): Rational { return rational(a.numerator * b.denominator + b.numerator * a.denominator, a.denominator * b.denominator); }
export function subtract(a: Rational, b: Rational): Rational { return rational(a.numerator * b.denominator - b.numerator * a.denominator, a.denominator * b.denominator); }
export function multiply(a: Rational, b: Rational): Rational { return rational(a.numerator * b.numerator, a.denominator * b.denominator); }
export function compare(a: Rational, b: Rational): -1 | 0 | 1 {
  const difference = a.numerator * b.denominator - b.numerator * a.denominator;
  return difference < 0n ? -1 : difference > 0n ? 1 : 0;
}
export function serializeRational(value: Rational): SerializedRational {
  const normalized = rational(value.numerator, value.denominator);
  return { numerator: normalized.numerator.toString(), denominator: normalized.denominator.toString() };
}
export const SerializedRationalSchema = z.object({
  numerator: z.string().max(4096).regex(/^(?:0|-?[1-9]\d*)$/), denominator: z.string().max(4096).regex(/^[1-9]\d*$/),
}).strict().superRefine((value, ctx) => {
  try {
    const normalized = serializeRational(rational(BigInt(value.numerator), BigInt(value.denominator)));
    if (normalized.numerator !== value.numerator || normalized.denominator !== value.denominator) ctx.addIssue({ code: 'custom', message: 'Rational strings must be reduced with a positive denominator' });
  } catch { ctx.addIssue({ code: 'custom', message: 'Invalid rational strings' }); }
});
export function deserializeRational(value: unknown): Rational {
  const parsed = SerializedRationalSchema.parse(value);
  return rational(BigInt(parsed.numerator), BigInt(parsed.denominator));
}

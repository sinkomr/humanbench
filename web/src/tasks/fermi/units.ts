/**
 * Units for Fermi answers (ROADMAP M5.1; DESIGN §3 row 11, §4.2 "Fermi truth values"). The TS mirror
 * of the bank's `hb.fermi.units`: a taker types a magnitude and picks a unit ("3.2e7" with "s", or
 * "533000" with "min"), and the answer is converted to the truth's unit before the log error is
 * taken, so a Fermi answer is judged on its size, never on which unit was chosen. Only
 * multiplicative units belong here (temperature scales have an offset).
 *
 * The table is a literal copy of the bank registry; `units.test.ts` compares it, exactly, with the
 * `units` of `golden/fermi_scoring_v1.json` (A17), so a unit added or changed on one side fails here.
 * `year` is the Julian year (365.25 days); `gal` the US liquid gallon; count and dollar units use the
 * short scale (a billion is 10^9).
 */

export const UNITS_VERSION = 'fermi-units-v1'

/** One unit: `factor` is the size of one unit in the dimension's base unit (the unit of factor 1). */
export interface Unit {
  readonly symbol: string
  readonly dimension: string
  readonly factor: number
  /** What the picker shows beside the symbol. */
  readonly label: string
}

const unit = (symbol: string, dimension: string, factor: number, label: string): Unit => Object.freeze({ symbol, dimension, factor, label })

/** Every unit, in the order the bank lists them (appending only). */
export const UNITS: readonly Unit[] = Object.freeze([
  // time (base: s)
  unit('ms', 'time', 0.001, 'milliseconds'),
  unit('s', 'time', 1, 'seconds'),
  unit('min', 'time', 60, 'minutes'),
  unit('h', 'time', 3600, 'hours'),
  unit('day', 'time', 86400, 'days'),
  unit('week', 'time', 604800, 'weeks'),
  unit('year', 'time', 31557600, 'years'),
  // length (base: m)
  unit('mm', 'length', 0.001, 'millimetres'),
  unit('cm', 'length', 0.01, 'centimetres'),
  unit('m', 'length', 1, 'metres'),
  unit('km', 'length', 1000, 'kilometres'),
  unit('in', 'length', 0.0254, 'inches'),
  unit('ft', 'length', 0.3048, 'feet'),
  unit('yd', 'length', 0.9144, 'yards'),
  unit('mi', 'length', 1609.344, 'miles'),
  // mass (base: kg)
  unit('mg', 'mass', 1e-06, 'milligrams'),
  unit('g', 'mass', 0.001, 'grams'),
  unit('kg', 'mass', 1, 'kilograms'),
  unit('t', 'mass', 1000, 'metric tonnes'),
  unit('oz', 'mass', 0.028349523125, 'ounces'),
  unit('lb', 'mass', 0.45359237, 'pounds'),
  // area (base: m2)
  unit('cm2', 'area', 0.0001, 'square centimetres'),
  unit('m2', 'area', 1, 'square metres'),
  unit('ha', 'area', 10000, 'hectares'),
  unit('km2', 'area', 1000000, 'square kilometres'),
  unit('ft2', 'area', 0.09290304, 'square feet'),
  unit('acre', 'area', 4046.8564224, 'acres'),
  unit('mi2', 'area', 2589988.110336, 'square miles'),
  // volume (base: m3)
  unit('mL', 'volume', 1e-06, 'millilitres'),
  unit('L', 'volume', 0.001, 'litres'),
  unit('m3', 'volume', 1, 'cubic metres'),
  unit('km3', 'volume', 1000000000, 'cubic kilometres'),
  unit('gal', 'volume', 0.003785411784, 'US gallons'),
  // speed (base: m/s)
  unit('m/s', 'speed', 1, 'metres per second'),
  unit('km/h', 'speed', 0.2777777777777778, 'kilometres per hour'),
  unit('mph', 'speed', 0.44704, 'miles per hour'),
  // energy (base: J)
  unit('J', 'energy', 1, 'joules'),
  unit('kJ', 'energy', 1000, 'kilojoules'),
  unit('kcal', 'energy', 4184, 'kilocalories'),
  unit('kWh', 'energy', 3600000, 'kilowatt-hours'),
  unit('GJ', 'energy', 1000000000, 'gigajoules'),
  // power (base: W)
  unit('W', 'power', 1, 'watts'),
  unit('kW', 'power', 1000, 'kilowatts'),
  unit('MW', 'power', 1000000, 'megawatts'),
  unit('GW', 'power', 1000000000, 'gigawatts'),
  unit('TW', 'power', 1000000000000, 'terawatts'),
  // count (base: count)
  unit('count', 'count', 1, '(plain number)'),
  unit('thousand', 'count', 1000, 'thousand'),
  unit('million', 'count', 1000000, 'million'),
  unit('billion', 'count', 1000000000, 'billion'),
  unit('trillion', 'count', 1000000000000, 'trillion'),
  unit('quadrillion', 'count', 1000000000000000, 'quadrillion'),
  // usd (base: usd)
  unit('usd', 'usd', 1, 'US dollars'),
  unit('kusd', 'usd', 1000, 'thousand US dollars'),
  unit('musd', 'usd', 1000000, 'million US dollars'),
  unit('busd', 'usd', 1000000000, 'billion US dollars'),
  unit('tusd', 'usd', 1000000000000, 'trillion US dollars'),
  // data (base: B)
  unit('B', 'data', 1, 'bytes'),
  unit('kB', 'data', 1000, 'kilobytes'),
  unit('MB', 'data', 1000000, 'megabytes'),
  unit('GB', 'data', 1000000000, 'gigabytes'),
  unit('TB', 'data', 1000000000000, 'terabytes'),
  unit('PB', 'data', 1000000000000000, 'petabytes'),
  // fraction (base: frac)
  unit('frac', 'fraction', 1, 'fraction (0 to 1)'),
  unit('pct', 'fraction', 0.01, 'percent'),
  unit('ppm', 'fraction', 1e-06, 'parts per million'),
])

const BY_SYMBOL: ReadonlyMap<string, Unit> = new Map(UNITS.map((u) => [u.symbol, u]))

/** The dimensions, in first-appearance order. */
export const DIMENSIONS: readonly string[] = Object.freeze([...new Set(UNITS.map((u) => u.dimension))])

/** Thrown for an unknown unit, or a unit used outside its dimension. */
export class UnitError extends RangeError {
  constructor(message: string) {
    super(message)
    this.name = 'UnitError'
  }
}

/** True iff `symbol` is a registered unit symbol. */
export function isUnit(symbol: unknown): symbol is string {
  return typeof symbol === 'string' && BY_SYMBOL.has(symbol)
}

/** The unit with this symbol; throws a {@link UnitError} for any other value. */
export function unitOf(symbol: string): Unit {
  const u = typeof symbol === 'string' ? BY_SYMBOL.get(symbol) : undefined
  if (u === undefined) throw new UnitError(`unknown unit ${JSON.stringify(symbol)}`)
  return u
}

/** The units of a dimension, in registry order; throws a {@link UnitError} if there are none. */
export function unitsOf(dimension: string): readonly Unit[] {
  const found = UNITS.filter((u) => u.dimension === dimension)
  if (found.length === 0) throw new UnitError(`unknown dimension ${JSON.stringify(dimension)}`)
  return found
}

/**
 * log10 of `value` (in `from`) expressed in `to`, taken in log space so no intermediate overflows or
 * underflows. `value` must be a finite number > 0 and the units must share a dimension (a
 * {@link UnitError} otherwise); the bank's `log10_between`.
 */
export function log10Between(value: number, from: string, to: string): number {
  const a = unitOf(from)
  const b = unitOf(to)
  if (a.dimension !== b.dimension) throw new UnitError(`cannot convert ${a.dimension} (${from}) to ${b.dimension} (${to})`)
  if (!(typeof value === 'number' && Number.isFinite(value) && value > 0)) throw new RangeError(`value must be finite and > 0, got ${String(value)}`)
  return Math.log10(value) + Math.log10(a.factor) - Math.log10(b.factor)
}

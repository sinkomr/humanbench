/**
 * The everyday settings of the qdata templates (DESIGN §3 row 6, §4.1 G6): exhibit titles, labels
 * and question wordings, as plain data. Every stem is one of these strings with its `{name}`
 * placeholders filled ({@link fill}), so the bank twin (`hb.gen.qdata.settings`) holds the same
 * strings and re-renders every TS stem byte for byte. Settings are culturally neutral: metric
 * units, "$" with cents, no brand names, no region-only facts, no gendered roles.
 *
 * Changing a string here changes generated items: bump the generator version (and the twin).
 */

export const DAYS = Object.freeze(['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'])
export const MONTHS = Object.freeze([
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
])
export const STOPS = Object.freeze(['Stop A', 'Stop B', 'Stop C', 'Stop D', 'Stop E', 'Stop F'])
export const TIMES = Object.freeze(['06:00', '08:00', '10:00', '12:00', '14:00', '16:00', '18:00'])
export const YEARS = Object.freeze(['Year 1', 'Year 2', 'Year 3', 'Year 4', 'Year 5', 'Year 6'])

/** Category lists by name (an exhibit's categories are a consecutive run of one of them). */
export const CATEGORY_LISTS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  days: DAYS,
  months: MONTHS,
  stops: STOPS,
  times: TIMES,
  years: YEARS,
})

/** Fill `{name}` placeholders; throws a RangeError on a placeholder without a value. */
export function fill(template: string, vars: Readonly<Record<string, string>>): string {
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (_, k: string) => {
    const v = vars[k]
    if (v === undefined) throw new RangeError(`no value for {${k}}`)
    return v
  })
}

// --- bar charts of counts (dt_bar_read, dt_bar_share) -------------------------------------------

export interface BarSetting {
  readonly id: string
  readonly title: string
  readonly unit: string
  readonly x_label: string
  readonly series: string
  readonly cats: string
  readonly lo: number
  readonly hi: number
  readonly diff: string
  readonly total: string
  readonly share: string
}

export const BAR_SETTINGS: readonly BarSetting[] = Object.freeze([
  {
    id: 'library',
    title: 'Books borrowed from a library',
    unit: 'books',
    x_label: 'Day',
    series: 'Books borrowed',
    cats: 'days',
    lo: 12,
    hi: 60,
    diff: 'How many more books were borrowed on {a} than on {b}?',
    total: 'How many books were borrowed in total on the days shown?',
    share: 'What percent of all the books borrowed on the days shown were borrowed on {a}?',
  },
  {
    id: 'bus',
    title: 'Passengers getting on a bus at each stop',
    unit: 'passengers',
    x_label: 'Stop',
    series: 'Passengers',
    cats: 'stops',
    lo: 3,
    hi: 40,
    diff: 'How many more passengers got on at {a} than at {b}?',
    total: 'How many passengers got on the bus in total at the stops shown?',
    share: 'What percent of all the passengers who got on at the stops shown got on at {a}?',
  },
  {
    id: 'rain',
    title: 'Rainfall in a town',
    unit: 'mm',
    x_label: 'Month',
    series: 'Rainfall',
    cats: 'months',
    lo: 10,
    hi: 95,
    diff: 'How many more millimetres of rain fell in {a} than in {b}?',
    total: 'How many millimetres of rain fell in total in the months shown?',
    share: 'What percent of all the rain that fell in the months shown fell in {a}?',
  },
  {
    id: 'plants',
    title: 'Plants sold at a garden shop',
    unit: 'plants',
    x_label: 'Day',
    series: 'Plants sold',
    cats: 'days',
    lo: 5,
    hi: 50,
    diff: 'How many more plants were sold on {a} than on {b}?',
    total: 'How many plants were sold in total on the days shown?',
    share: 'What percent of all the plants sold on the days shown were sold on {a}?',
  },
])

// --- tables of counts by day (dt_table_sum, dt_table_mean) -------------------------------------

export interface TableSetting {
  readonly id: string
  readonly title: string
  readonly columns: readonly string[]
  readonly row_q: string
  readonly col_q: string
  readonly mean_q: string
}

/** Every day table has row header "Day" and days as rows. */
export const DAY_ROW_HEADER = 'Day'

export const TABLE_SETTINGS: readonly TableSetting[] = Object.freeze([
  {
    id: 'market',
    title: 'Fruit sold at a market stall',
    columns: ['Apples', 'Pears', 'Plums'],
    row_q: 'How many pieces of fruit were sold in total on {row}?',
    col_q: 'How many {col} were sold in total on the days shown?',
    mean_q: 'What was the mean number of {col} sold per day on the days shown?',
  },
  {
    id: 'cafe',
    title: 'Cups of coffee sold at a café, by size',
    columns: ['Small', 'Medium', 'Large'],
    row_q: 'How many cups of coffee were sold in total on {row}?',
    col_q: 'How many {col} cups were sold in total on the days shown?',
    mean_q: 'What was the mean number of {col} cups sold per day on the days shown?',
  },
  {
    id: 'library',
    title: 'Books borrowed from a library, by type',
    columns: ['Fiction', 'Science', 'History'],
    row_q: 'How many books were borrowed in total on {row}?',
    col_q: 'How many {col} books were borrowed in total on the days shown?',
    mean_q: 'What was the mean number of {col} books borrowed per day on the days shown?',
  },
  {
    id: 'bikes',
    title: 'Bicycles rented at a park',
    columns: ['Morning', 'Afternoon', 'Evening'],
    row_q: 'How many bicycles were rented in total on {row}?',
    col_q: 'How many bicycles were rented in the {col} in total on the days shown?',
    mean_q: 'What was the mean number of bicycles rented in the {col} per day on the days shown?',
  },
])

// --- line charts of temperature (dt_line_temp) ---------------------------------------------------

export interface TempSetting {
  readonly id: string
  readonly title: string
  readonly x_label: string
  readonly cats: string
}

export const TEMP_UNIT = '°C'
export const TEMP_SERIES = 'Temperature'
export const TEMP_RANGE_Q = 'What is the difference between the highest and the lowest temperature shown, in °C?'
export const TEMP_CHANGE_Q = 'By how many degrees Celsius did the temperature change from {a} to {b}? Give a fall as a negative number.'

export const TEMP_SETTINGS: readonly TempSetting[] = Object.freeze([
  { id: 'station', title: 'Temperature at a weather station', x_label: 'Time', cats: 'times' },
  { id: 'hut', title: 'Temperature at a mountain hut', x_label: 'Time', cats: 'times' },
  { id: 'noon', title: 'Temperature at noon in a city', x_label: 'Day', cats: 'days' },
])

// --- line charts for percent change (dt_line_pct_change) ---------------------------------------

export interface PctSetting {
  readonly id: string
  readonly title: string
  readonly unit: string
  readonly x_label: string
  readonly series: string
  readonly cats: string
  readonly lo: number
  readonly hi: number
  readonly q: string
}

export const PCT_SETTINGS: readonly PctSetting[] = Object.freeze([
  {
    id: 'museum',
    title: 'Visitors to a museum',
    unit: 'visitors',
    x_label: 'Month',
    series: 'Visitors',
    cats: 'months',
    lo: 100,
    hi: 500,
    q: 'By what percent did the number of visitors change from {a} to {b}? Give a decrease as a negative number.',
  },
  {
    id: 'pass',
    title: 'Price of a monthly bus pass',
    unit: 'dollars',
    x_label: 'Year',
    series: 'Price',
    cats: 'years',
    lo: 20,
    hi: 100,
    q: 'By what percent did the price of the bus pass change from {a} to {b}? Give a decrease as a negative number.',
  },
  {
    id: 'pool',
    title: 'Swimmers at a pool',
    unit: 'swimmers',
    x_label: 'Day',
    series: 'Swimmers',
    cats: 'days',
    lo: 40,
    hi: 300,
    q: 'By what percent did the number of swimmers change from {a} to {b}? Give a decrease as a negative number.',
  },
])

// --- frequency tables (dt_freq_mean, dt_freq_median) ---------------------------------------------

export interface FreqSetting {
  readonly id: string
  readonly title: string
  readonly row_header: string
  readonly column: string
  /** The smallest value (the first row's label). */
  readonly start: number
  readonly mean_q: string
  readonly median_q: string
}

export const FREQ_SETTINGS: readonly FreqSetting[] = Object.freeze([
  {
    id: 'goals',
    title: 'Goals scored by a team in each match of a season',
    row_header: 'Goals in a match',
    column: 'Matches',
    start: 0,
    mean_q: 'What is the mean number of goals per match? Give a fraction in lowest terms or a whole number.',
    median_q: 'What is the median number of goals per match? Give a decimal if needed.',
  },
  {
    id: 'books',
    title: 'Books read last month by the students of a class',
    row_header: 'Books read',
    column: 'Students',
    start: 0,
    mean_q: 'What is the mean number of books read per student? Give a fraction in lowest terms or a whole number.',
    median_q: 'What is the median number of books read per student? Give a decimal if needed.',
  },
  {
    id: 'cars',
    title: 'People in each car passing a checkpoint',
    row_header: 'People in the car',
    column: 'Cars',
    start: 1,
    mean_q: 'What is the mean number of people per car? Give a fraction in lowest terms or a whole number.',
    median_q: 'What is the median number of people per car? Give a decimal if needed.',
  },
])

// --- two-way tables (dt_twoway_share) -----------------------------------------------------------

export interface TwowaySetting {
  readonly id: string
  readonly title: string
  readonly row_header: string
  readonly rows: readonly string[]
  readonly columns: readonly string[]
  readonly by_row: string
  readonly by_col: string
}

export const TWOWAY_SETTINGS: readonly TwowaySetting[] = Object.freeze([
  {
    id: 'lunch',
    title: 'Lunch choices of three classes',
    row_header: 'Class',
    rows: ['Class A', 'Class B', 'Class C'],
    columns: ['Soup', 'Salad', 'Pasta'],
    by_row: 'What fraction of the students in {row} chose {col}? Give a fraction in lowest terms.',
    by_col: 'Of the students who chose {col}, what fraction were in {row}? Give a fraction in lowest terms.',
  },
  {
    id: 'travel',
    title: 'How the members of a club travel to it',
    row_header: 'Age group',
    rows: ['Adults', 'Teenagers'],
    columns: ['Bus', 'Train', 'Bike', 'Car'],
    by_row: 'What fraction of the {rowl} travel by {col}? Give a fraction in lowest terms.',
    by_col: 'Of the members who travel by {col}, what fraction are {rowl}? Give a fraction in lowest terms.',
  },
  {
    id: 'sport',
    title: 'Sports chosen by students',
    row_header: 'Year',
    rows: ['Year 1', 'Year 2', 'Year 3'],
    columns: ['Swimming', 'Running', 'Tennis'],
    by_row: 'What fraction of the students in {row} chose {col}? Give a fraction in lowest terms.',
    by_col: 'Of the students who chose {col}, what fraction were in {row}? Give a fraction in lowest terms.',
  },
])

// --- one-column tables with a missing value (dt_missing_mean) ------------------------------------

export interface MissingSetting {
  readonly id: string
  readonly title: string
  readonly row_header: string
  readonly column: string
  readonly cats: string
  readonly lo: number
  readonly hi: number
  readonly q: string
}

export const MISSING_SETTINGS: readonly MissingSetting[] = Object.freeze([
  {
    id: 'pool',
    title: 'Visitors to a swimming pool',
    row_header: 'Day',
    column: 'Visitors',
    cats: 'days',
    lo: 20,
    hi: 90,
    q:
      'The table shows the number of visitors to a swimming pool on {k} days. The number for {miss} is missing. ' +
      'The mean number of visitors per day over all {n} days, {miss} included, was {mean}. How many visitors were there on {miss}?',
  },
  {
    id: 'bakery',
    title: 'Loaves of bread sold at a bakery',
    row_header: 'Day',
    column: 'Loaves',
    cats: 'days',
    lo: 30,
    hi: 99,
    q:
      'The table shows the number of loaves of bread sold at a bakery on {k} days. The number for {miss} is missing. ' +
      'The mean number of loaves sold per day over all {n} days, {miss} included, was {mean}. How many loaves were sold on {miss}?',
  },
  {
    id: 'rain',
    title: 'Rainfall in a town',
    row_header: 'Month',
    column: 'Rainfall (mm)',
    cats: 'months',
    lo: 10,
    hi: 95,
    q:
      'The table shows the rainfall in a town in {k} months. The rainfall for {miss} is missing. ' +
      'The mean monthly rainfall over all {n} months, {miss} included, was {mean} mm. How many millimetres of rain fell in {miss}?',
  },
])

// --- line charts with two series (dt_two_series) ------------------------------------------------

export interface TwoSeriesSetting {
  readonly id: string
  readonly title: string
  readonly unit: string
  readonly x_label: string
  readonly cats: string
  readonly names: readonly [string, string]
  readonly lo: number
  readonly hi: number
  readonly total_q: string
  readonly max_q: string
}

export const TWO_SERIES_SETTINGS: readonly TwoSeriesSetting[] = Object.freeze([
  {
    id: 'bikes',
    title: 'Bicycles sold by two shops',
    unit: 'bicycles',
    x_label: 'Month',
    cats: 'months',
    names: ['Shop A', 'Shop B'],
    lo: 10,
    hi: 60,
    total_q: 'Over the months shown, how many more bicycles did {more} sell than {less} in total?',
    max_q: 'What was the largest difference between the numbers of bicycles sold by the two shops in any one month?',
  },
  {
    id: 'parks',
    title: 'Visitors to two parks',
    unit: 'visitors',
    x_label: 'Day',
    cats: 'days',
    names: ['River Park', 'Hill Park'],
    lo: 20,
    hi: 90,
    total_q: 'Over the days shown, how many more visitors did {more} have than {less} in total?',
    max_q: 'What was the largest difference between the numbers of visitors to the two parks on any one day?',
  },
  {
    id: 'kiosks',
    title: 'Drinks sold at two kiosks',
    unit: 'drinks',
    x_label: 'Day',
    cats: 'days',
    names: ['North Kiosk', 'South Kiosk'],
    lo: 15,
    hi: 70,
    total_q: 'Over the days shown, how many more drinks did the {more} sell than the {less} in total?',
    max_q: 'What was the largest difference between the numbers of drinks sold at the two kiosks on any one day?',
  },
])

// --- bar charts of yearly percent changes (dt_compound_change) ---------------------------------

export interface CompoundSetting {
  readonly id: string
  readonly title: string
  readonly subject: string
}

export const COMPOUND_UNIT = '%'
export const COMPOUND_X_LABEL = 'Year'
export const COMPOUND_SERIES = 'Change'
export const COMPOUND_FORWARD_Q =
  'The chart shows the percent change in {subject} during each of {k} years. By what percent did {subject} change over the {k} years in all? ' +
  'Give a decrease as a negative number, and a decimal if needed.'
export const COMPOUND_REVERSE_Q =
  'The chart shows the percent change in {subject} during each of {k} years. At the end of {last} it was {end}. ' +
  'What was it at the start of Year 1, in dollars to the cent?'

export const COMPOUND_SETTINGS: readonly CompoundSetting[] = Object.freeze([
  { id: 'pass', title: 'Yearly change in the price of a bus pass', subject: 'the price of a bus pass' },
  { id: 'rent', title: 'Yearly change in the rent of a flat', subject: 'the rent of a flat' },
  { id: 'fund', title: 'Yearly change in the value of a savings fund', subject: 'the value of a savings fund' },
])

// --- two-year tables of shares (dt_share_change) -------------------------------------------------

export interface ShareSetting {
  readonly id: string
  readonly title: string
  readonly row_header: string
  readonly cats: readonly string[]
  /** "{cat} trips": what one category's count is called. */
  readonly part: string
  /** "all trips". */
  readonly whole: string
}

export const SHARE_COLUMNS = Object.freeze(['Year 1', 'Year 2'])
export const SHARE_PP_Q =
  'The share of {part} is the number of {part} as a percent of all {whole} in that year. ' +
  'By how many percentage points did the share of {part} change from Year 1 to Year 2? Give a fall as a negative number.'
export const SHARE_REL_Q =
  'The share of {part} is the number of {part} as a percent of all {whole} in that year. ' +
  'By what percent did the share of {part} change from Year 1 to Year 2? ' +
  'Give the relative change of the share, not the change in percentage points, and a fall as a negative number.'

export const SHARE_SETTINGS: readonly ShareSetting[] = Object.freeze([
  {
    id: 'travel',
    title: 'Trips to work, by way of travel',
    row_header: 'Way of travel',
    cats: ['Bus', 'Train', 'Bike', 'Car', 'Walking'],
    part: '{cat} trips',
    whole: 'trips',
  },
  {
    id: 'books',
    title: 'Books borrowed from a library, by type',
    row_header: 'Type of book',
    cats: ['Fiction', 'Science', 'History', 'Art', 'Travel'],
    part: '{cat} books',
    whole: 'books borrowed',
  },
  {
    id: 'tickets',
    title: 'Tickets sold at a theatre, by type',
    row_header: 'Type of ticket',
    cats: ['Adult', 'Child', 'Student', 'Group'],
    part: '{cat} tickets',
    whole: 'tickets sold',
  },
])

// --- word problems ------------------------------------------------------------------------------

export const NAMES = Object.freeze(['Maya', 'Sam', 'Priya', 'Leo', 'Ana', 'Kenji', 'Zoe', 'Omar'])
export const SHOP_ITEMS = Object.freeze(['notebook', 'pen', 'sandwich', 'bottle of water', 'loaf of bread', 'bus ticket', 'magazine', 'box of pencils'])
export const NOTES = Object.freeze([5, 10, 20, 50])
export const VEHICLES = Object.freeze(['train', 'bus', 'ferry', 'tram'])
export const GOODS = Object.freeze(['rice', 'pasta', 'oats', 'tea', 'flour', 'coffee beans'])
export const PACK_SIZES = Object.freeze([200, 250, 300, 400, 500, 750, 1000])
export const THINGS = Object.freeze(['jacket', 'lamp', 'backpack', 'board game', 'toaster', 'desk chair', 'kettle', 'tent'])

export interface Ingredient {
  readonly id: string
  readonly sing: string
  readonly pl: string
}

export const INGREDIENTS: readonly Ingredient[] = Object.freeze([
  { id: 'milk', sing: 'litre', pl: 'litres' },
  { id: 'flour', sing: 'kg', pl: 'kg' },
  { id: 'rice', sing: 'kg', pl: 'kg' },
  { id: 'stock', sing: 'litre', pl: 'litres' },
])

export interface WorkSetting {
  readonly id: string
  readonly machine: string
  readonly machines: string
  readonly task: string
}

export const WORK_SETTINGS: readonly WorkSetting[] = Object.freeze([
  { id: 'pump', machine: 'pump', machines: 'pumps', task: 'fill a tank' },
  { id: 'printer', machine: 'printer', machines: 'printers', task: 'print a batch of leaflets' },
  { id: 'packer', machine: 'packing machine', machines: 'packing machines', task: 'pack an order of boxes' },
])

export interface MixSetting {
  readonly id: string
  readonly what: string
  readonly part: string
  readonly lo: number
  readonly hi: number
}

export const MIX_SETTINGS: readonly MixSetting[] = Object.freeze([
  { id: 'juice', what: 'juice drink', part: 'fruit juice', lo: 10, hi: 90 },
  { id: 'salt', what: 'salt solution', part: 'salt', lo: 2, hi: 30 },
])

export const WP = Object.freeze({
  change: '{name} buys a {item1} for {price1} and a {item2} for {price2}, and pays with a {note} note. How much change does {name} get, in dollars to the cent?',
  timetable: 'A {vehicle} leaves at {dep} and arrives at {arr} on the same day. How many minutes does the trip take?',
  bill_split:
    'A group of {people} friends share a restaurant bill of {bill}. They add a tip of {tip}% of the bill and split the total equally. ' +
    'How much does each person pay, in dollars to the cent?',
  unit_price:
    'A shop sells {good} in a {size1} g pack for {price1} and in a {size2} g pack for {price2}. Work out the price per 100 g of each pack. ' +
    'How many cents per 100 g cheaper is the better-value pack?',
  recipe:
    'A recipe for {people1} people uses {amount} {sing} of {ingredient}. How many {pl} of {ingredient} are needed for {people2} people at the same rate? ' +
    'Give a fraction in lowest terms or a whole number.',
  fuel: 'A car uses {rate} litres of fuel per 100 km. Fuel costs {price} per litre. How much does the fuel for a {distance} km trip cost, in dollars to the cent?',
  discount_tax:
    'A {thing} costs {price}. In a sale it is {off}% off, and then a tax of {tax}% of the sale price is added. What is the final price, in dollars to the cent?',
  work_together:
    'One {machine} can {task} in {a} hours. A second {machine} can do the same job in {b} hours. ' +
    'Working together at these rates, how many minutes do the two {machines} take to do the job?',
  mixture: '{x} litres of a {what} that is {p}% {part} are mixed with {y} litres of a {what} that is {q}% {part}. What percent of the mixture is {part}?',
  reverse_pct:
    'The price of a {thing} was raised by {up}%. Later the new price was cut by {down}%. The {thing} now costs {now}. ' +
    'What was the price before both changes, in dollars to the cent?',
})

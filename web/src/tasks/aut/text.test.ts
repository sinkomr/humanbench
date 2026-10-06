import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  MAX_RESPONSE_CHARS,
  PERSONAL_INFO_KINDS,
  REDACTED,
  cleanResponse,
  indefiniteArticle,
  personalInfo,
  redactPersonalInfo,
  templateText,
  wordCount,
  type PersonalInfoKind,
} from './text'

describe('cleanResponse (M6.4)', () => {
  it('normalises to NFC', () => {
    expect(cleanResponse('café table')).toBe('café table')
  })

  it('turns tabs and line breaks into spaces and strips other control and format characters', () => {
    expect(cleanResponse('build\ta\nwall')).toBe('build a wall')
    expect(cleanResponse('door\u0000stop\u0007')).toBe('doorstop')
    expect(cleanResponse('door​stop ‮evil‬')).toBe('doorstop evil')
    expect(cleanResponse('﻿bookend')).toBe('bookend')
  })

  it('trims and collapses whitespace (including non-breaking and ideographic spaces)', () => {
    expect(cleanResponse('   use   as   a　 step  ')).toBe('use as a step')
    expect(cleanResponse(' \n\t ')).toBe('')
  })

  it('caps at 120 code points without splitting a surrogate pair', () => {
    expect(MAX_RESPONSE_CHARS).toBe(120)
    expect(cleanResponse('x'.repeat(500))).toHaveLength(120)
    const emoji = '\u{1F9F1}'.repeat(130) // brick emoji, 2 UTF-16 units each
    const out = cleanResponse(emoji)
    expect(Array.from(out)).toHaveLength(120)
    expect(out).toBe('\u{1F9F1}'.repeat(120))
    // a cut that lands on a space leaves no trailing space
    expect(cleanResponse(`${'a'.repeat(119)} bcd`)).toBe('a'.repeat(119))
  })

  it('returns "" for a non-string', () => {
    expect(cleanResponse(undefined as unknown as string)).toBe('')
  })

  it('property: idempotent, short, trimmed, no control characters', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'binary', maxLength: 300 }), (raw) => {
        const once = cleanResponse(raw)
        expect(cleanResponse(once)).toBe(once)
        expect(Array.from(once).length).toBeLessThanOrEqual(MAX_RESPONSE_CHARS)
        expect(once).toBe(once.trim())
        expect(/[\p{Cc}\p{Cf}]/u.test(once)).toBe(false)
        expect(/\s{2}/u.test(once)).toBe(false)
        expect(once).toBe(once.normalize('NFC'))
      }),
      { numRuns: 500 },
    )
  })

  it('property: idempotent on mixed text with combining marks and spaces', () => {
    const piece = fc.constantFrom('a', 'é', ' ', ' ', '\n', '‍', '\u{1F9F1}', 'Z', '̈', '1', '.')
    fc.assert(
      fc.property(fc.array(piece, { maxLength: 200 }), (parts) => {
        const once = cleanResponse(parts.join(''))
        expect(cleanResponse(once)).toBe(once)
      }),
    )
  })
})

describe('wordCount (M6.4)', () => {
  it.each([
    ['', 0],
    ['   ', 0],
    ['doorstop', 1],
    ['use as a doorstop', 4],
    ['use it - as a step...', 5],
    ['... - !!', 0],
    ['3 bricks', 2],
    ['café table', 2],
  ])('%j has %i words', (s, n) => {
    expect(wordCount(s)).toBe(n)
  })
})

describe('templateText (M6.4)', () => {
  it.each([
    ['brick', 'a use for a brick'],
    ['paperclip', 'a use for a paperclip'],
    ['egg', 'a use for an egg'],
    ['old shoe', 'a use for an old shoe'],
    ['umbrella', 'a use for an umbrella'],
    ['hour glass', 'a use for an hour glass'],
    ['unicorn toy', 'a use for a unicorn toy'],
    ['USB stick', 'a use for a USB stick'],
    ['ukulele', 'a use for a ukulele'],
    ['one-way mirror', 'a use for a one-way mirror'],
    ['  tin   can ', 'a use for a tin can'],
    ['the moon', 'a use for the moon'],
    ['an apple', 'a use for an apple'],
  ])('%j gives %j', (object, text) => {
    expect(templateText(object)).toBe(text)
  })

  it('throws for an empty object', () => {
    expect(() => templateText('  ')).toThrow(RangeError)
  })

  it('indefiniteArticle', () => {
    expect(indefiniteArticle('apple')).toBe('an')
    expect(indefiniteArticle('honest broker')).toBe('an')
    expect(indefiniteArticle('euro coin')).toBe('a')
    expect(indefiniteArticle('urn')).toBe('an')
  })
})

/* ---------------------------------------------------------------- personal information */

const POSITIVE: readonly (readonly [string, PersonalInfoKind])[] = [
  // email
  ['email me at jane.doe@example.com', 'email'],
  ['JANE_DOE+aut@mail.co.uk', 'email'],
  ['jane@example', 'email'],
  ['jane (at) example (dot) com', 'email'],
  ['jane at example dot com', 'email'],
  ['jane [at] example [dot] org', 'email'],
  ['jane dot doe at gmail dot com', 'email'],
  // phone
  ['call 555-123-4567', 'phone'],
  ['(555) 123-4567', 'phone'],
  ['555.123.4567', 'phone'],
  ['+44 20 7946 0958', 'phone'],
  ['07700 900123', 'phone'],
  ['5551234', 'phone'],
  ['+1 (555) 123 4567 anytime', 'phone'],
  ['text 555 1234', 'phone'],
  ['+1-555-123-4567', 'phone'],
  ['my number is 07700900123', 'phone'],
  ['020 7946 0958', 'phone'],
  ['192.168.0.1', 'phone'], // any dotted run of 7+ digits
  ['０７７００９００１２３', 'phone'], // fullwidth digits
  // url
  ['see https://example.com/page', 'url'],
  ['http://foo.bar', 'url'],
  ['www.example.org', 'url'],
  ['WWW.Example.Com/shop', 'url'],
  ['visit example.com', 'url'],
  ['my-shop.co.uk', 'url'],
  ['brick.io', 'url'],
  ['my site dot com', 'url'],
  ['mailto:jane', 'url'],
  ['jane@ gmail.com', 'url'],
  ['twitter.com/jane', 'url'],
  // handle
  ['follow @janedoe', 'handle'],
  ['@jane_doe on insta', 'handle'],
  ['u/janedoe', 'handle'],
  // long number
  ['12345', 'long_number'],
  ['account 98765', 'long_number'],
  ['code 1234567890123456789', 'phone'],
  // street address
  ['221B Baker Street', 'street_address'],
  ['10 Downing St', 'street_address'],
  ['42 Elm Rd.', 'street_address'],
  ['1600 Pennsylvania Avenue NW', 'street_address'],
  ['7 Oak Ave', 'street_address'],
  ['3 Mill Lane', 'street_address'],
  ['9 Park Ln', 'street_address'],
  ['12 Ocean Drive', 'street_address'],
  ['5 Hill Dr', 'street_address'],
  ['4 The Close', 'street_address'],
  ['8 Kings Court', 'street_address'],
  ['15 Long Way', 'street_address'],
  ['100 Sunset Boulevard', 'street_address'],
  ['2 Main Blvd', 'street_address'],
  ['#12 Green Street', 'street_address'],
  ['I live at 14 north west road', 'street_address'],
  ['PO Box 123', 'street_address'],
  ['P.O. Box 9', 'street_address'],
  ['Hauptstraße 5', 'street_address'],
  ['house 12, elm street', 'street_address'],
  ['flat 3, 14 high street', 'street_address'],
  ['apt 4b 120 main st, springfield', 'street_address'],
  // postcode
  ['SW1A 1AA', 'postcode'],
  ['M1 1AE', 'postcode'],
  ['EC1A 1BB', 'postcode'],
  ['b33 8th', 'postcode'],
  ['K1A 0B1', 'postcode'],
  ['M5V 3L9', 'postcode'],
  ['90210-1234', 'postcode'],
  ['Beverly Hills, CA 90210', 'postcode'],
  ['zip 10001', 'postcode'],
  ['NY 10001', 'postcode'],
  ['sw1a1aa', 'postcode'],
  ['k1a0b1', 'postcode'],
  ['H3Z 2Y7', 'postcode'],
]

/** Typical responses (and near misses) that must not be flagged. */
const NEGATIVE: readonly string[] = [
  'use as a doorstop',
  'build a wall',
  'throw it through a window',
  'stack 3 in a row as a step',
  'use 2 to drive nails',
  'drive 1 nail into the wall',
  'carry 10 bricks up the drive',
  'grind into red pigment',
  'a pillow for a very tough person',
  'hold down 4 sheets of paper',
  'make a 3D printer stand',
  'heat it in the oven at 200 degrees',
  'e.g. as a hammer',
  'i.e. a weight',
  'use it on the way to work',
  'walk 2 miles a day with it',
  'a tiny 5 cm sculpture',
  'a 2-way radio antenna',
  'party like it is 1999',
  'year 2024 time capsule',
  'use as a doorstop.',
  'hit 1 ball, then 2',
  'paint 3 stripes on it',
  'tie it with string at home',
  'use 4 as table legs',
  'a 1:1 scale model',
  'put 12 of them in a circle',
  'make a 6 ft wall',
  'a court marker',
  'St. Patrick day decoration',
  'reset a router',
  'pick a lock',
  'a bookmark at page 300',
  'email',
  'a web page weight',
  'a hashtag #brick',
  'sharpen 2 knives',
  'a doorstop @ the office',
  'R2D2 costume part',
  'mp3 player stand',
  'A4 paper holder',
  '50 50 chance coin',
  '',
]

describe('personalInfo (M6.4; DESIGN §8)', () => {
  it.each(POSITIVE)('%j is flagged as %s', (text, kind) => {
    expect(personalInfo(text)).toContain(kind)
  })

  it.each(NEGATIVE.map((s) => [s]))('%j is not flagged', (text) => {
    expect(personalInfo(text)).toEqual([])
  })

  it('a 6-digit run is a long number, not a phone', () => {
    expect(personalInfo('id 123456')).not.toContain('phone')
    expect(personalInfo('id 123456')).toContain('long_number')
  })

  it('reports each kind once, in PERSONAL_INFO_KINDS order', () => {
    const kinds = personalInfo('mail a@b.com or c@d.com, call 555-123-4567, see www.x.org, @me, 12 High St, SW1A 1AA')
    expect(kinds).toEqual(['email', 'phone', 'url', 'handle', 'street_address', 'postcode'])
    expect([...kinds].sort((a, b) => PERSONAL_INFO_KINDS.indexOf(a) - PERSONAL_INFO_KINDS.indexOf(b))).toEqual(kinds)
  })

  it("an email's domain is not also a url, nor its user part a handle", () => {
    expect(personalInfo('jane@example.com')).toEqual(['email'])
  })

  it('returns [] for a non-string', () => {
    expect(personalInfo(null as unknown as string)).toEqual([])
  })

  it('property: digits anywhere in a run of 7+ are flagged', () => {
    fc.assert(
      fc.property(fc.stringMatching(/^[0-9]{7,15}$/), fc.constantFrom('', 'call ', 'my number '), (digits, pre) => {
        expect(personalInfo(`${pre}${digits}`).length).toBeGreaterThan(0)
      }),
    )
  })

  it('property: any name@domain.tld is flagged as email', () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^[a-z][a-z0-9._]{0,10}$/),
        fc.stringMatching(/^[a-z][a-z0-9-]{0,10}$/),
        fc.constantFrom('com', 'org', 'net', 'co.uk', 'io', 'de'),
        (user, host, tld) => {
          expect(personalInfo(`write to ${user}@${host}.${tld} please`)).toContain('email')
        },
      ),
    )
  })
})

describe('redactPersonalInfo (M6.4)', () => {
  it('replaces each piece with the marker and keeps the rest', () => {
    expect(redactPersonalInfo('email jane@example.com for bricks')).toBe(`email ${REDACTED} for bricks`)
    expect(redactPersonalInfo('call 555-123-4567 or visit www.x.org')).toBe(`call ${REDACTED} or visit ${REDACTED}`)
    expect(redactPersonalInfo('use as a doorstop')).toBe('use as a doorstop')
  })

  it('property: a redacted response has no personal information left', () => {
    const piece = fc.constantFrom('jane@example.com', '555-123-4567', 'www.x.org', '@jane', '98765', '12 High St', 'SW1A 1AA', 'brick', 'wall', 'use as', 'a')
    fc.assert(
      fc.property(fc.array(piece, { minLength: 1, maxLength: 8 }), (parts) => {
        expect(personalInfo(redactPersonalInfo(parts.join(' ')))).toEqual([])
      }),
    )
  })
})

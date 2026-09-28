/**
 * Copy of the mental-rotation renderer (ROADMAP M1.13, A13; DESIGN §4.2, §12 stem, §13
 * accessibility). Text alternatives describe the figures structurally without revealing the
 * answer: every option has exactly as many cubes as the target (the verifier's `cube_count`), so
 * the cube count is the one structural fact that is the same for all four. Arm counts or arm
 * lengths are NOT described: the one-cube-moved pair can differ from the target's pair in them,
 * which would halve the choice.
 */

/** The item stem (§12 example stem, with "target" for the figure above the options). */
export const ROTATION_STEM = 'Which option is the same object as the target, rotated? (Not mirror-imaged.)'

/** Legend of the option group. */
export const ROTATION_OPTIONS_LEGEND = 'Options'

/** Shown when the 3D figures cannot be drawn (no WebGL); the session offers skipping (§13). */
export const ROTATION_UNAVAILABLE = 'The 3D figures could not be drawn in this browser, so this question cannot be answered here.'

/** Text alternative of the target figure. */
export function targetAlt(nCubes: number): string {
  return `Target: a 3D object made of ${nCubes} cubes joined face to face, drawn from a fixed viewpoint.`
}

/** Text alternative (and accessible name) of option `letter`. */
export function optionAlt(letter: string, nCubes: number): string {
  return `Option ${letter}: a 3D object made of ${nCubes} cubes.`
}

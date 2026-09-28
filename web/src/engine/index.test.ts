import { describe, expect, it } from 'vitest'
import * as engine from './index'

describe('engine barrel (index.ts)', () => {
  it('re-exports the public API of every engine module', () => {
    const names = [
      // prng.ts
      'createRng', 'cyrb128', 'sfc32', 'forkSeed', 'seedString', 'WARMUP_ROUNDS',
      // axes.ts
      'AXES', 'AXIS_CODES', 'AXIS_INDEX', 'CLUSTERS', 'N_AXES', 'TIER_GLYPH', 'axis', 'isAxisCode',
      'initialCorrelation', 'initialSigma', 'rawInitialSigma', 'nearestPD', 'SIGMA_EIGEN_FLOOR',
      'SIGMA_VERSION', 'SIGMA_NEAREST_PD_CHANGED', 'R_LITERATURE', 'R_DEFAULT',
      // linalg.ts
      'cholesky', 'tryCholesky', 'choleskySolve', 'choleskyInverse', 'choleskyLogDet', 'solve',
      'inverse', 'spdSolve', 'spdInverse', 'matmul', 'matvec', 'transpose', 'symmetricEigen',
      // irt.ts
      'logistic', 'logLogistic', 'p2pl', 'p3pl', 'grmProbs', 'grmLogProbs', 'info2pl', 'info3pl',
      'infoGrm', 'infoGaussian', 'check3pl', 'checkGaussian', 'checkGrm',
      'observationLoglik', 'observationScore', 'observationInfo', 'observedInfo3pl', 'observedInfoGrm',
      'observationObservedInfo',
      // scorer.ts
      'logPosterior', 'gradLogPosterior', 'mapTheta', 'eapAxis', 'eapByAxis', 'scoreAll', 'checkObservation',
      'expectedInformation', 'observedInformation', 'MAP_MAX_ITER', 'MAP_TOL', 'MAP_MAX_HALVINGS',
      'MAP_LP_SLACK', 'EAP_N_GRID', 'EAP_LO', 'EAP_HI',
      // types.ts
      'isResponseTuple', 'isJsonValue',
    ]
    for (const n of names) expect(engine, n).toHaveProperty(n)
  })

  it('does not re-export the selector, which imports the task registry (import cycle, M1.14)', () => {
    for (const n of ['selectNext', 'candidatePool', 'planSession', 'scheduleBlocks']) expect(engine).not.toHaveProperty(n)
  })
})

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
      // integrity.ts
      'integrityReport', 'visibilityCheck', 'pasteCheck', 'tooFastCheck', 'uniformRtCheck', 'hardItemCheck',
      'personFitCheck', 'hiddenIntervals', 'poissonBinomialPmf', 'poissonBinomialUpperTail', 'lzStar',
      'bayesModalTheta', 'bayesModalR0', 'dichotomousObservation', 'pCorrect', 'calibrationEligible', 'FLAG_KINDS',
      'HIDDEN_MAX_S', 'TOO_FAST_RATIO', 'TOO_FAST_MIN_MEDIAN_S', 'UNIFORM_RT_MAX_SD', 'UNIFORM_RT_MIN_TIME_RATIO',
      'UNIFORM_RT_MIN_ITEMS', 'HARD_ITEM_MARGIN', 'HARD_ITEM_ALPHA', 'LZ_STAR_MAX', 'LZ_STAR_MIN_ITEMS',
      'PERSON_FIT_PRIOR_MEAN', 'PERSON_FIT_PRIOR_SD',
      // irt.ts
      'logistic', 'logLogistic', 'p2pl', 'p3pl', 'grmProbs', 'grmLogProbs', 'info2pl', 'info3pl',
      'infoGrm', 'infoGaussian', 'check3pl', 'checkGaussian', 'checkGrm',
      'observationLoglik', 'observationScore', 'observationInfo', 'observedInfo3pl', 'observedInfoGrm',
      'observationObservedInfo',
      // scorer.ts
      'logPosterior', 'gradLogPosterior', 'mapTheta', 'eapAxis', 'eapByAxis', 'scoreAll', 'checkObservation',
      'expectedInformation', 'observedInformation', 'MAP_MAX_ITER', 'MAP_TOL', 'MAP_MAX_HALVINGS',
      'MAP_LP_SLACK', 'EAP_N_GRID', 'EAP_LO', 'EAP_HI',
      // retest.ts
      'RETEST_VERSION', 'RETEST_TAU', 'RHO_MAX_FLUID', 'RHO_MAX_KNOWLEDGE', 'RHO_MAX_BY_CLUSTER', 'RHO_MAX_PRIOR',
      'resolveRhoMax', 'retestGain', 'adjustObservation', 'orderSessions', 'sessionSittings', 'sessionOrdinals', 'retestAdjust',
      'rescoreRetest', 'nextSessionPrior',
      // types.ts
      'isResponseTuple', 'isJsonValue',
    ]
    for (const n of names) expect(engine, n).toHaveProperty(n)
  })

  it('does not re-export the selector, which imports the task registry (import cycle, M1.14)', () => {
    for (const n of ['selectNext', 'candidatePool', 'planSession', 'scheduleBlocks']) expect(engine).not.toHaveProperty(n)
  })
})

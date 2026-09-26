import { describe, expect, it } from 'vitest'
import * as engine from './index'

describe('engine barrel (index.ts)', () => {
  it('re-exports the public API of every M1.1 module', () => {
    const names = [
      // prng.ts
      'createRng', 'cyrb128', 'sfc32', 'forkSeed', 'seedString', 'WARMUP_ROUNDS',
      // axes.ts
      'AXES', 'AXIS_CODES', 'AXIS_INDEX', 'CLUSTERS', 'N_AXES', 'TIER_GLYPH', 'axis', 'isAxisCode',
      'initialCorrelation', 'initialSigma', 'rawInitialSigma', 'nearestPD', 'SIGMA_EIGEN_FLOOR',
      // linalg.ts
      'cholesky', 'tryCholesky', 'choleskySolve', 'choleskyInverse', 'choleskyLogDet', 'solve',
      'inverse', 'spdSolve', 'spdInverse', 'matmul', 'matvec', 'transpose', 'symmetricEigen',
      // irt.ts
      'logistic', 'logLogistic', 'p2pl', 'p3pl', 'grmProbs', 'grmLogProbs', 'info2pl', 'info3pl',
      'infoGrm', 'infoGaussian', 'check3pl', 'checkGaussian', 'checkGrm',
      'observationLoglik', 'observationScore', 'observationInfo',
      // types.ts
      'isResponseTuple', 'isJsonValue',
    ]
    for (const n of names) expect(engine, n).toHaveProperty(n)
  })
})

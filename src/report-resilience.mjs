export function reportHasCandidates(report) {
  return Boolean(report && (
    (Array.isArray(report.candidates) && report.candidates.length)
    || (Array.isArray(report.discoveryCandidates) && report.discoveryCandidates.length)
  ));
}

export function buildFreshDataStatus(generatedAt, options = {}) {
  const reason = options.reason || null;
  return {
    stale: false,
    partial: Boolean(reason),
    reason,
    lastSuccessfulAt: generatedAt,
    retryAt: options.retryAt || null
  };
}

export function buildStaleReport(previous, options = {}) {
  const generatedAt = options.generatedAt || new Date().toISOString();
  const base = previous || {
    chains: options.chains || [],
    candidates: [],
    discoveryCandidates: [],
    alerts: [],
    deepAnalysis: {},
    calibration: {},
    strategies: {}
  };
  const lastSuccessfulAt = base.dataStatus?.stale
    ? base.dataStatus.lastSuccessfulAt
    : base.generatedAt || null;
  return {
    ...base,
    generatedAt,
    alerts: [],
    errors: [...(options.errors || [])],
    notices: [...(options.notices || [])],
    dataStatus: {
      stale: true,
      reason: options.reason || "scan_failed",
      lastSuccessfulAt,
      retryAt: options.retryAt || null
    }
  };
}

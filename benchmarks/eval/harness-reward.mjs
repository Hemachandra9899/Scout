export function computeReward(row) {
  let reward = 0;
  const reasons = [];

  if (row.routingPassed) {
    reward += 1;
    reasons.push("+1 routing correct");
  } else {
    reward -= 2;
    reasons.push("-2 wrong route/tool");
  }

  if (row.correctness >= 0.7) {
    reward += 1;
    reasons.push("+1 correctness");
  } else {
    reward -= 2;
    reasons.push("-2 low correctness");
  }

  if (row.completeness >= 0.7) {
    reward += 1;
    reasons.push("+1 completeness");
  } else {
    reward -= 1;
    reasons.push("-1 low completeness");
  }

  const minGroundedRatio = row.minGroundedRatio ?? 0;
  if (minGroundedRatio > 0 && row.groundedRatio >= minGroundedRatio) {
    reward += 1;
    reasons.push("+1 grounded enough");
  } else if (minGroundedRatio > 0) {
    reward -= 2;
    reasons.push("-2 low groundedness");
  }

  if (row.mustNotClaimPassed === false) {
    reward -= 3;
    reasons.push("-3 forbidden claim");
  }

  if (row.latencyPassed === false) {
    reward -= 1;
    reasons.push("-1 slow latency");
  }

  return { reward, reasons };
}

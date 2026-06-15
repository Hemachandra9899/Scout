function num(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function text(value) {
  return String(value ?? "").toLowerCase();
}

function isExpectedNoEvidenceCase(row) {
  const id = text(row.id);
  const answer = text(row.answerPreview ?? row.answer);
  const failures = text(row.failures);

  return (
    id.includes("insufficient-evidence") ||
    answer.includes("not enough evidence") ||
    answer.includes("do not have enough evidence") ||
    failures.includes("not enough evidence")
  );
}

function isPartialOrTimeout(row) {
  const status = text(row.status);
  const failures = text(row.failures);
  const answer = text(row.answerPreview ?? row.answer);

  return (
    status.includes("partial") ||
    failures.includes("timeout") ||
    failures.includes("timed out") ||
    answer.includes("could not complete") ||
    answer.includes("within the time limit")
  );
}

export function computeReward(row) {
  let reward = 0;
  const reasons = [];

  const routingPassed = row.routingPassed === true;
  const mustMentionPassed = row.mustMentionPassed !== false;
  const mustNotClaimPassed = row.mustNotClaimPassed !== false;

  const correctness = num(row.correctness);
  const completeness = num(row.completeness);
  const groundedRatio = num(row.groundedRatio);
  const minGroundedRatio = num(row.minGroundedRatio);
  const latencyMs = num(row.latencyMs);
  const maxLatencyMs = num(row.maxLatencyMs, Number.POSITIVE_INFINITY);

  const expectedNoEvidence = isExpectedNoEvidenceCase(row);
  const partialOrTimeout = isPartialOrTimeout(row);

  if (routingPassed) {
    reward += 2;
    reasons.push("+2 routing correct");
  } else {
    reward -= 4;
    reasons.push("-4 wrong route/tool");
  }

  if (correctness >= 0.7) {
    reward += 1;
    reasons.push("+1 correctness");
  } else {
    reward -= 3;
    reasons.push("-3 low correctness");
  }

  if (completeness >= 0.7) {
    reward += 1;
    reasons.push("+1 completeness");
  } else {
    reward -= 3;
    reasons.push("-3 low completeness");
  }

  if (mustMentionPassed) {
    reward += 1;
    reasons.push("+1 required content covered");
  } else {
    reward -= 4;
    reasons.push("-4 missing required content");
  }

  if (groundedRatio >= minGroundedRatio) {
    reward += 1;
    reasons.push("+1 grounded enough");
  } else {
    reward -= 3;
    reasons.push("-3 low groundedness");
  }

  if (!mustNotClaimPassed) {
    reward -= 5;
    reasons.push("-5 forbidden claim");
  }

  if (latencyMs > maxLatencyMs) {
    reward -= 2;
    reasons.push("-2 slow latency");
  }

  if (partialOrTimeout && !expectedNoEvidence) {
    reward -= 3;
    reasons.push("-3 partial/timeout for answerable query");
  }

  if (!row.passed && !expectedNoEvidence && reward > 0) {
    reasons.push(`cap reward ${reward} -> 0 because case failed`);
    reward = 0;
  }

  if (expectedNoEvidence && mustNotClaimPassed && correctness >= 0.7) {
    reward = Math.max(reward, 2);
    reasons.push("floor reward to +2 for safe no-evidence refusal");
  }

  return { reward, reasons };
}

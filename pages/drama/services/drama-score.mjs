export function normalizeDramaScore(value) {
  if (typeof value !== 'number' && typeof value !== 'string') {
    return '';
  }

  let score = value;
  if (typeof value === 'string') {
    const decimal = value.trim();
    if (!/^(?:[0-9]+(?:\.[0-9]+)?|\.[0-9]+)$/.test(decimal)) {
      return '';
    }
    score = Number(decimal);
  }
  if (!Number.isFinite(score) || score < 0 || score > 10) {
    return '';
  }
  return score.toFixed(1);
}

export function normalizeDramaRecordScore(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    return record;
  }
  const isPangleDrama = record.source === 'pangle-drama-sdk';
  if (!isPangleDrama && !Object.prototype.hasOwnProperty.call(record, 'score')) {
    return record;
  }
  const scoreSource =
    isPangleDrama && record.raw && typeof record.raw === 'object' ? record.raw.score : record.score;
  return {
    ...record,
    score: normalizeDramaScore(scoreSource),
  };
}

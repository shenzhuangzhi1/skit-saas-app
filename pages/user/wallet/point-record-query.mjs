export function createPointRecordQueryGate() {
  let epoch = 0;
  let sequence = 0;
  let activeRequest = null;

  const isCurrent = (request) =>
    request !== null && activeRequest === request && request.epoch === epoch;

  return Object.freeze({
    invalidate() {
      epoch += 1;
      activeRequest = null;
      return epoch;
    },
    tryStart(snapshot = {}) {
      if (activeRequest) {
        return null;
      }
      activeRequest = Object.freeze({
        ...snapshot,
        epoch,
        requestId: ++sequence,
      });
      return activeRequest;
    },
    isCurrent,
    finish(request) {
      if (!isCurrent(request)) {
        return false;
      }
      activeRequest = null;
      return true;
    },
    isLoading() {
      return activeRequest !== null;
    },
  });
}

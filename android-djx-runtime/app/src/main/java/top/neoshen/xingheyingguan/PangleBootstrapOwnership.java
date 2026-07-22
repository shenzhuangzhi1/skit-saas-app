package top.neoshen.xingheyingguan;

/**
 * Process-scoped ownership state for the global TTAdSdk singleton.
 *
 * <p>A ready singleton is trusted only after this app completed its own accepted init/start
 * attempt. This prevents another SDK path from winning the singleton identity race.</p>
 */
final class PangleBootstrapOwnership {
    enum Decision {
        START_OWNED,
        JOIN_OWNED_START,
        REUSE_OWNED,
        REJECT_UNOWNED_READY,
        REJECT_OWNED_STATE_LOST
    }

    static final class Request {
        private final Decision decision;
        private final long attempt;

        private Request(Decision decision, long attempt) {
            this.decision = decision;
            this.attempt = attempt;
        }

        Decision getDecision() {
            return decision;
        }

        long getAttempt() {
            return attempt;
        }
    }

    private enum State {
        IDLE,
        STARTING,
        OWNED_READY
    }

    private State state = State.IDLE;
    private long currentAttempt;

    synchronized Request request(boolean globalReady) {
        if (state == State.OWNED_READY) {
            return new Request(
                    globalReady ? Decision.REUSE_OWNED : Decision.REJECT_OWNED_STATE_LOST,
                    currentAttempt);
        }
        if (state == State.STARTING) {
            return new Request(Decision.JOIN_OWNED_START, currentAttempt);
        }
        if (globalReady) {
            return new Request(Decision.REJECT_UNOWNED_READY, currentAttempt);
        }
        state = State.STARTING;
        currentAttempt += 1;
        return new Request(Decision.START_OWNED, currentAttempt);
    }

    synchronized boolean completeSuccess(long attempt) {
        if (state != State.STARTING || currentAttempt != attempt) {
            return false;
        }
        state = State.OWNED_READY;
        return true;
    }

    synchronized boolean completeFailure(long attempt) {
        if (state != State.STARTING || currentAttempt != attempt) {
            return false;
        }
        state = State.IDLE;
        return true;
    }
}

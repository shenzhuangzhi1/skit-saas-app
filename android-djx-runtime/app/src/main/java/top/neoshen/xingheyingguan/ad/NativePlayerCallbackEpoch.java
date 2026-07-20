package top.neoshen.xingheyingguan.ad;

/** Rejects late callbacks from a DJX widget after that widget has been replaced or suspended. */
public final class NativePlayerCallbackEpoch {
    private long epoch;

    public long next() {
        return ++epoch;
    }

    public void invalidate() {
        epoch++;
    }

    public boolean isCurrent(long candidate) {
        return candidate > 0L && candidate == epoch;
    }
}

package top.neoshen.xingheyingguan;

/** Strict, tenant-provided display-ad request. */
final class TakuDisplayAdRequest {
    enum Type {
        INTERSTITIAL,
        BANNER
    }

    private final Type type;
    private final String placementId;
    private final String scene;

    TakuDisplayAdRequest(Type type, String placementId, String scene) {
        if (type == null || placementId == null || scene == null) {
            throw new IllegalArgumentException("Display-ad request fields are required");
        }
        this.type = type;
        this.placementId = placementId;
        this.scene = scene;
    }

    Type getType() {
        return type;
    }

    String getPlacementId() {
        return placementId;
    }

    String getScene() {
        return scene;
    }

    boolean matches(TakuDisplayAdRequest other) {
        return other != null
                && type == other.type
                && placementId.equals(other.placementId)
                && scene.equals(other.scene);
    }
}

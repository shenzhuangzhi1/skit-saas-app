<template>
  <view class="drama-card" :class="mode" @tap="$emit('select', drama)">
    <view class="poster" :style="{ background: drama.cover }">
      <view class="poster-shade"></view>
      <view class="poster-score">{{ drama.score }}</view>
      <view class="poster-title">{{ drama.title }}</view>
    </view>
    <view class="info">
      <view class="title ss-line-1">{{ drama.title }}</view>
      <view class="meta ss-line-1">
        {{ drama.status }} · {{ drama.total }}集 · {{ drama.heat }}
      </view>
      <view v-if="episode" class="progress ss-line-1">
        看到第{{ episode }}集 / 共{{ drama.total }}集
      </view>
    </view>
  </view>
</template>

<script setup>
  defineProps({
    drama: {
      type: Object,
      required: true,
    },
    episode: {
      type: Number,
      default: 0,
    },
    mode: {
      type: String,
      default: 'grid',
    },
  });

  defineEmits(['select']);
</script>

<style lang="scss" scoped>
  .drama-card {
    min-width: 0;
  }

  .poster {
    position: relative;
    width: 100%;
    aspect-ratio: 3 / 4;
    overflow: hidden;
    border-radius: 12rpx;
    box-shadow: 0 16rpx 34rpx rgba(20, 20, 20, 0.12);
  }

  .poster-shade {
    position: absolute;
    inset: 0;
    background: linear-gradient(180deg, rgba(0, 0, 0, 0.06), rgba(0, 0, 0, 0.58)),
      radial-gradient(circle at 70% 20%, rgba(255, 255, 255, 0.38), transparent 34%);
  }

  .poster-score {
    position: absolute;
    top: 12rpx;
    right: 12rpx;
    min-width: 54rpx;
    height: 32rpx;
    padding: 0 10rpx;
    border-radius: 18rpx;
    background: rgba(0, 0, 0, 0.46);
    color: #fff;
    font-size: 22rpx;
    line-height: 32rpx;
    text-align: center;
  }

  .poster-title {
    position: absolute;
    left: 14rpx;
    right: 14rpx;
    bottom: 16rpx;
    color: #fff;
    font-size: 30rpx;
    font-weight: 700;
    line-height: 38rpx;
  }

  .info {
    padding-top: 12rpx;
  }

  .title {
    color: #191919;
    font-size: 28rpx;
    font-weight: 600;
    line-height: 36rpx;
  }

  .meta,
  .progress {
    margin-top: 4rpx;
    color: #888;
    font-size: 22rpx;
    line-height: 30rpx;
  }

  .progress {
    color: #ff5a1f;
  }

  .drama-card.compact {
    width: 168rpx;
    flex-shrink: 0;
    margin-right: 22rpx;

    .title {
      font-size: 26rpx;
    }
  }
</style>

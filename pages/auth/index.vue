<template>
  <view class="auth-page">
    <view class="page-head">
      <view class="back-button" @tap="goBack">
        <uni-icons type="left" size="22" color="#ffffff" />
      </view>
      <view class="brand">短剧 SaaS</view>
      <view class="headline">{{ state.mode === 'login' ? '欢迎回来' : '加入代理商团队' }}</view>
      <view class="subtitle">
        {{ state.mode === 'login' ? '登录后同步邀请关系与收益身份' : '注册必须填写有效邀请码' }}
      </view>
    </view>

    <view class="auth-card">
      <view class="mode-tabs">
        <view class="mode-tab" :class="{ active: state.mode === 'login' }" @tap="setMode('login')">
          登录
        </view>
        <view
          class="mode-tab"
          :class="{ active: state.mode === 'register' }"
          @tap="setMode('register')"
        >
          注册
        </view>
      </view>

      <view v-if="state.mode === 'login'" class="form-body">
        <view class="field">
          <view class="field-label">手机号</view>
          <input
            v-model="state.login.mobile"
            class="field-input"
            type="number"
            maxlength="11"
            placeholder="请输入手机号"
          />
        </view>
        <view class="field">
          <view class="field-label">密码</view>
          <input
            v-model="state.login.password"
            class="field-input"
            password
            placeholder="请输入密码"
          />
        </view>
        <view class="field">
          <view class="field-label">代理商编码（可选）</view>
          <input
            v-model="state.login.tenantCode"
            class="field-input"
            maxlength="64"
            placeholder="同一手机号属于多个代理商时填写"
          />
        </view>
        <button class="submit-button" :loading="state.submitting" @tap="submitLogin"> 登录 </button>
        <view class="form-tip" @tap="setMode('register')">没有账号？使用邀请码注册</view>
      </view>

      <view v-else class="form-body">
        <view class="field">
          <view class="field-label">昵称</view>
          <input
            v-model="state.register.nickname"
            class="field-input"
            maxlength="30"
            placeholder="请输入昵称"
          />
        </view>
        <view class="field">
          <view class="field-label">手机号</view>
          <input
            v-model="state.register.mobile"
            class="field-input"
            type="number"
            maxlength="11"
            placeholder="请输入手机号"
          />
        </view>
        <view class="field">
          <view class="field-label">密码</view>
          <input
            v-model="state.register.password"
            class="field-input"
            password
            maxlength="32"
            placeholder="至少 6 位"
          />
        </view>
        <view class="field invite-field">
          <view class="field-label">邀请码</view>
          <view class="invite-row">
            <input
              v-model="state.register.inviteCode"
              class="field-input invite-input"
              maxlength="64"
              placeholder="必填"
              @blur="resolveInvitation"
            />
            <button class="resolve-button" :loading="state.resolving" @tap="resolveInvitation">
              验证
            </button>
          </view>
          <view
            v-if="state.invitationMessage"
            class="invite-message"
            :class="{ invalid: !state.invitationValid }"
          >
            {{ state.invitationMessage }}
          </view>
        </view>
        <button class="submit-button" :loading="state.submitting" @tap="submitRegister">
          注册并登录
        </button>
        <view class="form-tip" @tap="setMode('login')">已有账号？返回登录</view>
      </view>
    </view>
  </view>
</template>

<script setup>
  import { reactive } from 'vue';
  import { onLoad } from '@dcloudio/uni-app';
  import AuthUtil from '@/sheep/api/member/auth';
  import InvitationApi from '@/sheep/api/member/invitation';

  const state = reactive({
    mode: 'login',
    submitting: false,
    resolving: false,
    invitationValid: false,
    invitationMessage: '',
    login: {
      mobile: '',
      password: '',
      tenantCode: '',
    },
    register: {
      mobile: '',
      password: '',
      nickname: '',
      inviteCode: '',
    },
  });

  function setMode(mode) {
    state.mode = mode;
  }

  function toast(title) {
    uni.showToast({ title, icon: 'none' });
  }

  function validateMobile(mobile) {
    return /^1\d{10}$/.test(String(mobile || '').trim());
  }

  async function submitLogin() {
    if (state.submitting) {
      return;
    }
    const mobile = state.login.mobile.trim();
    const password = state.login.password;
    const tenantCode = state.login.tenantCode.trim();
    if (!validateMobile(mobile)) {
      toast('请输入正确的手机号');
      return;
    }
    if (!password) {
      toast('请输入密码');
      return;
    }

    state.submitting = true;
    try {
      const payload = { mobile, password };
      if (tenantCode) {
        payload.tenantCode = tenantCode;
      }
      const result = await AuthUtil.login(payload);
      if (result?.code === 0) {
        finishAuth();
      }
    } finally {
      state.submitting = false;
    }
  }

  async function resolveInvitation() {
    const inviteCode = state.register.inviteCode.trim();
    state.invitationValid = false;
    state.invitationMessage = '';
    if (!inviteCode) {
      state.invitationMessage = '请输入邀请码';
      return false;
    }

    state.resolving = true;
    try {
      const result = await InvitationApi.resolve(inviteCode);
      if (result?.code !== 0 || result?.data?.valid === false) {
        state.invitationMessage = result?.msg || '邀请码无效或已停用';
        return false;
      }
      const data = result.data || {};
      const inviterName =
        data.inviterNickname || data.nickname || data.inviterName || data.inviter?.nickname || '';
      const tenantName =
        data.tenantName ||
        data.agentName ||
        data.agencyName ||
        data.tenant?.name ||
        data.agent?.name ||
        '';
      state.invitationValid = true;
      state.invitationMessage =
        [tenantName, inviterName && `邀请人：${inviterName}`].filter(Boolean).join(' · ') ||
        '邀请码有效';
      return true;
    } catch (error) {
      state.invitationMessage = '邀请码验证失败，请稍后重试';
      return false;
    } finally {
      state.resolving = false;
    }
  }

  async function submitRegister() {
    if (state.submitting) {
      return;
    }
    const mobile = state.register.mobile.trim();
    const password = state.register.password;
    const nickname = state.register.nickname.trim();
    const inviteCode = state.register.inviteCode.trim();
    if (!nickname) {
      toast('请输入昵称');
      return;
    }
    if (!validateMobile(mobile)) {
      toast('请输入正确的手机号');
      return;
    }
    if (password.length < 6) {
      toast('密码至少 6 位');
      return;
    }
    if (!inviteCode) {
      toast('注册必须填写邀请码');
      return;
    }
    if (!(await resolveInvitation())) {
      return;
    }

    state.submitting = true;
    try {
      const result = await AuthUtil.register({ mobile, password, nickname, inviteCode });
      if (result?.code === 0) {
        finishAuth();
      }
    } finally {
      state.submitting = false;
    }
  }

  function finishAuth() {
    const pages = getCurrentPages();
    if (pages.length > 1) {
      uni.navigateBack();
      return;
    }
    uni.switchTab({ url: '/pages/index/user' });
  }

  function goBack() {
    const pages = getCurrentPages();
    if (pages.length > 1) {
      uni.navigateBack();
      return;
    }
    uni.switchTab({ url: '/pages/index/user' });
  }

  onLoad((options = {}) => {
    const inviteCode = options.inviteCode || options.code || '';
    state.login.tenantCode = options.tenantCode || '';
    if (options.mode === 'register' || inviteCode) {
      state.mode = 'register';
    }
    if (inviteCode) {
      state.register.inviteCode = inviteCode;
      resolveInvitation();
    }
  });
</script>

<style lang="scss" scoped>
  .auth-page {
    min-height: 100vh;
    padding-bottom: 64rpx;
    background: #f5f5f5;
    color: #202020;
  }

  .page-head {
    box-sizing: border-box;
    min-height: 420rpx;
    padding: calc(34rpx + env(safe-area-inset-top)) 40rpx 100rpx;
    background: linear-gradient(150deg, #ff6a22 0%, #ff4a1a 52%, #251918 100%);
    color: #fff;
  }

  .back-button {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 64rpx;
    height: 64rpx;
    margin-left: -14rpx;
  }

  .brand {
    margin-top: 28rpx;
    color: rgba(255, 255, 255, 0.72);
    font-size: 24rpx;
    letter-spacing: 4rpx;
  }

  .headline {
    margin-top: 18rpx;
    font-size: 54rpx;
    font-weight: 800;
  }

  .subtitle {
    margin-top: 16rpx;
    color: rgba(255, 255, 255, 0.78);
    font-size: 26rpx;
  }

  .auth-card {
    margin: -64rpx 24rpx 0;
    padding: 36rpx 30rpx 42rpx;
    border-radius: 28rpx;
    background: #fff;
    box-shadow: 0 18rpx 48rpx rgba(35, 20, 16, 0.12);
  }

  .mode-tabs {
    display: flex;
    border-bottom: 1rpx solid #eeeeee;
  }

  .mode-tab {
    position: relative;
    flex: 1;
    padding: 12rpx 0 28rpx;
    color: #999;
    font-size: 32rpx;
    text-align: center;
  }

  .mode-tab.active {
    color: #191919;
    font-weight: 800;
  }

  .mode-tab.active::after {
    position: absolute;
    right: 38%;
    bottom: 0;
    left: 38%;
    height: 6rpx;
    border-radius: 6rpx;
    background: #ff5a1f;
    content: '';
  }

  .form-body {
    padding-top: 24rpx;
  }

  .field {
    margin-top: 26rpx;
  }

  .field-label {
    margin-bottom: 12rpx;
    color: #555;
    font-size: 25rpx;
    font-weight: 600;
  }

  .field-input {
    box-sizing: border-box;
    width: 100%;
    height: 88rpx;
    padding: 0 24rpx;
    border: 2rpx solid #ededed;
    border-radius: 16rpx;
    background: #fafafa;
    font-size: 28rpx;
  }

  .invite-row {
    display: flex;
    align-items: center;
  }

  .invite-input {
    flex: 1;
    min-width: 0;
  }

  .resolve-button {
    width: 136rpx;
    height: 88rpx;
    margin-left: 14rpx;
    padding: 0;
    border: 0;
    border-radius: 16rpx;
    background: #fff0e9;
    color: #ff5a1f;
    font-size: 26rpx;
    line-height: 88rpx;
  }

  .resolve-button::after,
  .submit-button::after {
    border: 0;
  }

  .invite-message {
    margin-top: 12rpx;
    color: #1d9f57;
    font-size: 24rpx;
  }

  .invite-message.invalid {
    color: #e34d59;
  }

  .submit-button {
    height: 92rpx;
    margin-top: 42rpx;
    border: 0;
    border-radius: 46rpx;
    background: linear-gradient(90deg, #ff6a22, #ff4519);
    color: #fff;
    font-size: 31rpx;
    font-weight: 700;
    line-height: 92rpx;
    box-shadow: 0 14rpx 30rpx rgba(255, 82, 28, 0.24);
  }

  .form-tip {
    padding-top: 28rpx;
    color: #ff5a1f;
    font-size: 25rpx;
    text-align: center;
  }
</style>

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { extname } from 'node:path';

const sourceExtensions = new Set([
  '.cjs',
  '.gradle',
  '.html',
  '.java',
  '.js',
  '.json',
  '.kt',
  '.kts',
  '.mjs',
  '.properties',
  '.sh',
  '.ts',
  '.tsx',
  '.vue',
  '.xml',
  '.yaml',
  '.yml',
]);
const trackedFiles = execFileSync('git', ['ls-files'], { encoding: 'utf8' })
  .split('\n')
  .filter(Boolean)
  .filter((file) => file !== 'scripts/check-member-identity-boundary.mjs')
  // Generated fallback assets are verified by the Android package gates after a fresh H5 build.
  .filter((file) => !file.startsWith('android-djx-runtime/static-www/'))
  .filter((file) => sourceExtensions.has(extname(file)))
  .filter((file) => existsSync(file));

const forbiddenPatterns = [
  ['/member/auth/', /(?<!\/skit)\/member\/auth\//],
  ['/member/user/', /(?<!\/skit)\/member\/user\//],
  ['/member/(sign-in|point)/', /(?<!\/skit)\/member\/(?:sign-in|point)\//],
  [
    'legacy AuthUtil identity method',
    /AuthUtil\.(?:smsLogin|sendSmsCode|socialAuthRedirect|socialLogin|weixinMiniAppLogin|createWeixinMpJsapiSignature)\b/,
  ],
  [
    'legacy UserApi mutation method',
    /UserApi\.(?:updateUser|updateUserMobile|updateUserMobileByWeixin|updateUserPassword|resetUserPassword)\b/,
  ],
  ['legacy social identity method', /SocialApi\.(?:socialBind|socialUnbind|getSocialUser)\b/],
  [
    'legacy authorization modal',
    /showAuthModal\(['"](?:accountLogin|smsLogin|resetPassword|changeMobile|changePassword|mpAuthorization)['"]\)/,
  ],
  ['one-click phone authorization', /open-type=["']getPhoneNumber["']/],
  ['legacy OAuth callback page', /pages\/index\/login/],
  [
    'legacy provider identity method',
    /useProvider\([^)]*\)\.(?:login|bind|unbind|mobileLogin|bindUserPhoneNumber|getInfo)\b/,
  ],
];

const violations = [];
for (const file of trackedFiles) {
  const source = readFileSync(file, 'utf8');
  source.split('\n').forEach((line, index) => {
    for (const [label, pattern] of forbiddenPatterns) {
      if (pattern.test(line)) {
        violations.push(`${file}:${index + 1}: ${label}: ${line.trim()}`);
      }
    }
  });
  if (file.startsWith('sheep/platform/provider/')) {
    source.split('\n').forEach((line, index) => {
      if (
        /(?:\b(?:async\s+)?function|\bconst)\s+(?:login|bind|unbind|mobileLogin|bindUserPhoneNumber|getInfo)\b/.test(
          line,
        ) ||
        /^\s*(?:login|bind|unbind|mobileLogin|bindUserPhoneNumber|getInfo),?\s*$/.test(line)
      ) {
        violations.push(
          `${file}:${index + 1}: platform identity provider is not allowed: ${line.trim()}`,
        );
      }
    });
  }
}

const requiredEndpoints = [
  '/skit/member/auth/bootstrap',
  '/skit/member/auth/login',
  '/skit/member/auth/register',
  '/skit/member/auth/logout',
  '/skit/member/auth/refresh-token',
  '/skit/member/user/profile',
  '/skit/member/check-ins',
  '/skit/member/point-records',
];

const apiSources = [
  readFileSync('sheep/api/member/auth.js', 'utf8'),
  readFileSync('sheep/api/member/user.js', 'utf8'),
  readFileSync('sheep/api/member/signin.js', 'utf8'),
  readFileSync('sheep/api/member/point.js', 'utf8'),
].join('\n');
for (const endpoint of requiredEndpoints) {
  if (!apiSources.includes(endpoint)) {
    violations.push(`missing required Skit endpoint: ${endpoint}`);
  }
}

const requiredSourceMarkers = new Map([
  ['pages.json', ['"path": "pages/auth/index"']],
  [
    'pages/auth/index.vue',
    ['AuthUtil.login', 'AuthUtil.register', 'InvitationApi.resolve', 'inviteCode', 'contextToken'],
  ],
  [
    'sheep/platform/pay.js',
    [
      'wechatMiniProgramPay',
      'wechatAppPay',
      "provider: 'wxpay'",
      "provider: 'alipay'",
      "this.prepay('wx_app')",
      "this.prepay('alipay_app')",
      'resolve({ code: -1, data: null });',
    ],
  ],
  ['sheep/libs/sdk-h5-weixin.js', ['chooseWXPay', 'updateAppMessageShareData']],
]);
for (const [file, markers] of requiredSourceMarkers) {
  const source = readFileSync(file, 'utf8');
  for (const marker of markers) {
    if (!source.includes(marker)) {
      violations.push(`${file}: missing required source marker: ${marker}`);
    }
  }
}

if (violations.length > 0) {
  console.error('Member identity boundary violations:');
  for (const violation of violations) {
    console.error(`- ${violation}`);
  }
  process.exit(1);
}

console.log(
  `Member identity boundary verified across ${trackedFiles.length} tracked source files.`,
);

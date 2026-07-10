// #ifdef H5
import officialAccountService from './officialAccount';
// #endif

// #ifdef MP-WEIXIN
import miniProgramService from './miniProgram';
// #endif

// #ifdef APP-PLUS
import openPlatformService from './openPlatform';
// #endif

let wechat = {};
// #ifdef H5
wechat = officialAccountService;
// #endif
// #ifdef MP-WEIXIN
wechat = miniProgramService;
// #endif
// #ifdef APP-PLUS
wechat = openPlatformService;
// #endif

export default wechat;

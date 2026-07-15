import request from '@/sheep/request';

const authenticatedRequest = {
  auth: true,
  showLoading: false,
  showError: false,
};

const AdSessionApi = {
  issuePlayerGrant: (dramaId) =>
    request({
      url: '/skit/member/player-grants',
      method: 'POST',
      data: { dramaId },
      custom: authenticatedRequest,
    }),

  createAdSession: (data) =>
    request({
      url: '/skit/member/ad-sessions',
      method: 'POST',
      data,
      custom: authenticatedRequest,
    }),

  recordClientEvents: (sessionId, events) =>
    request({
      url: `/skit/member/ad-sessions/${encodeURIComponent(sessionId)}/client-events`,
      method: 'POST',
      data: { events },
      custom: authenticatedRequest,
    }),

  getAdSession: (sessionId) =>
    request({
      url: `/skit/member/ad-sessions/${encodeURIComponent(sessionId)}`,
      method: 'GET',
      custom: authenticatedRequest,
    }),
};

export default AdSessionApi;

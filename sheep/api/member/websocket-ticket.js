import request from '@/sheep/request';

const WebSocketTicketApi = {
  issueTicket: () =>
    request({
      url: '/infra/websocket-tickets',
      method: 'POST',
      custom: {
        auth: true,
        showLoading: false,
        showError: false,
      },
    }),
};

export default WebSocketTicketApi;

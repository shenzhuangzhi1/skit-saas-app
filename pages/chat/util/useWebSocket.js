import { onBeforeUnmount, reactive, ref } from 'vue';
import { baseUrl, websocketPath } from '@/sheep/config';
import { copyValueToTarget } from '@/sheep/helper/utils';
import WebSocketTicketApi from '@/sheep/api/member/websocket-ticket';
import { openWebSocketWithFreshTicket } from './websocket-ticket';

/**
 * WebSocket 创建 hook
 * @param opt 连接配置
 * @return {{options: *}}
 */
export function useWebSocket(opt) {
  const options = reactive({
    isReconnecting: false, // 正在重新连接
    reconnectInterval: 3000, // 重连间隔，单位毫秒
    heartBeatInterval: 5000, // 心跳间隔，单位毫秒
    pingTimeoutDuration: 1000, // 超过这个时间，后端没有返回pong，则判定后端断线了。
    heartBeatTimer: null, // 心跳计时器
    destroy: false, // 是否销毁
    pingTimeout: null, // 心跳检测定时器
    reconnectTimeout: null, // 重连定时器ID的属性
    onConnected: () => {}, // 连接成功时触发
    onClosed: () => {}, // 连接关闭时触发
    onMessage: (data) => {}, // 收到消息
  });
  const SocketTask = ref(null); // SocketTask 由 uni.connectSocket() 接口创建
  let connectionGeneration = 0;
  let isConnecting = false;

  copyValueToTarget(options, opt);

  const initEventListeners = (socketTask) => {
    // 监听 WebSocket 连接打开事件
    socketTask.onOpen(() => {
      if (SocketTask.value !== socketTask || options.destroy) {
        return;
      }
      console.log('WebSocket 连接成功');
      options.isReconnecting = false;
      // 连接成功时触发
      options.onConnected();
      // 开启心跳检查
      startHeartBeat();
    });
    // 监听 WebSocket 接受到服务器的消息事件
    socketTask.onMessage((res) => {
      if (SocketTask.value !== socketTask || options.destroy) {
        return;
      }
      try {
        if (res.data === 'pong') {
          // 收到心跳重置心跳超时检查
          resetPingTimeout();
        } else {
          options.onMessage(JSON.parse(res.data));
        }
      } catch (error) {
        console.error(error);
      }
    });
    // 监听 WebSocket 连接关闭事件
    socketTask.onClose(() => {
      if (SocketTask.value !== socketTask) {
        return;
      }
      SocketTask.value = null;
      stopHeartBeat();
      // 情况一：实例销毁
      if (options.destroy) {
        options.onClosed();
      } else {
        // 情况二：连接失败重连
        reconnect();
      }
    });
  };

  // 发送消息
  const sendMessage = (message) => {
    if (SocketTask.value && !options.destroy) {
      SocketTask.value.send({ data: message });
    }
  };
  // 开始心跳检查
  const startHeartBeat = () => {
    stopHeartBeat();
    options.heartBeatTimer = setInterval(() => {
      sendMessage('ping');
      options.pingTimeout = setTimeout(() => {
        // 如果在超时时间内没有收到 pong，则认为连接断开
        reconnect();
      }, options.pingTimeoutDuration);
    }, options.heartBeatInterval);
  };
  // 停止心跳检查
  const stopHeartBeat = () => {
    clearInterval(options.heartBeatTimer);
    resetPingTimeout();
  };

  // WebSocket 重连
  const reconnect = () => {
    if (options.destroy) {
      return;
    }

    stopHeartBeat();
    connectionGeneration += 1;

    const staleSocketTask = SocketTask.value;
    SocketTask.value = null;
    if (staleSocketTask) {
      staleSocketTask.close();
    }

    // 重连中
    options.isReconnecting = true;

    // 清除现有的重连标志，以避免多次重连
    if (options.reconnectTimeout) {
      clearTimeout(options.reconnectTimeout);
    }

    // 设置重连延迟
    options.reconnectTimeout = setTimeout(() => {
      if (!options.destroy) {
        options.reconnectTimeout = null;
        void initSocket();
      }
    }, options.reconnectInterval);
  };

  const resetPingTimeout = () => {
    if (options.pingTimeout) {
      clearTimeout(options.pingTimeout);
      options.pingTimeout = null; // 清除超时ID
    }
  };

  const close = () => {
    if (options.destroy) {
      return;
    }
    options.destroy = true;
    connectionGeneration += 1;
    stopHeartBeat();
    if (options.reconnectTimeout) {
      clearTimeout(options.reconnectTimeout);
      options.reconnectTimeout = null;
    }
    const socketTask = SocketTask.value;
    SocketTask.value = null;
    if (socketTask) {
      socketTask.close();
    }
    options.onClosed();
  };

  const initSocket = async () => {
    if (options.destroy || isConnecting) {
      return;
    }

    isConnecting = true;
    const generation = ++connectionGeneration;
    try {
      const socketTask = await openWebSocketWithFreshTicket({
        baseUrl,
        websocketPath,
        issueTicket: WebSocketTicketApi.issueTicket,
        connectSocket: ({ url }) =>
          uni.connectSocket({
            url,
            complete: () => {},
            success: () => {},
          }),
        isCancelled: () => options.destroy || generation !== connectionGeneration,
      });
      if (options.destroy || generation !== connectionGeneration) {
        socketTask?.close?.();
        return;
      }
      SocketTask.value = socketTask;
      initEventListeners(socketTask);
    } catch (_error) {
      if (!options.destroy && generation === connectionGeneration) {
        console.warn('WebSocket ticket 签发失败，未建立连接');
        reconnect();
      }
    } finally {
      isConnecting = false;
    }
  };

  void initSocket();

  onBeforeUnmount(() => {
    close();
  });
  return { options };
}

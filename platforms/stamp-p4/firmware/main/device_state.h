/**
 * 设备状态机：Wi-Fi / WebSocket 连接状态与重连退避。
 * 薄客户端原则：不在设备端持久化业务状态。
 */
#ifndef MINDIOU_DEVICE_STATE_H
#define MINDIOU_DEVICE_STATE_H

#include <stdbool.h>
#include <stdint.h>

typedef enum {
    DEV_STATE_BOOT = 0,
    DEV_STATE_WIFI_CONNECTING,
    DEV_STATE_WIFI_CONNECTED,
    DEV_STATE_WS_CONNECTING,
    DEV_STATE_WS_CONNECTED,
    DEV_STATE_WS_READY,      /* device_hello + capabilities 已发送 */
    DEV_STATE_DISCONNECTED   /* 断线，等待重连 */
} device_state_t;

void device_state_init(void);
void device_state_set(device_state_t state);
device_state_t device_state_get(void);
bool device_state_is_ready(void);

/* 指数退避重连：返回下次重连前等待 ms，上限 CONFIG_MINDIOU_RECONNECT_MAX_MS。 */
uint32_t device_state_next_backoff_ms(void);
void device_state_reset_backoff(void);

#endif

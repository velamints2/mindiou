#ifndef MINDIOU_WIFI_CLIENT_H
#define MINDIOU_WIFI_CLIENT_H

#include <stdbool.h>

/* 阻塞直到 Wi-Fi 连接成功（含事件注册）。成功返回 true。 */
bool wifi_client_connect(void);
int wifi_client_rssi(void);

#endif

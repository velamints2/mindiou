#ifndef MINDIOU_WS_CLIENT_H
#define MINDIOU_WS_CLIENT_H

#include <stdbool.h>

/* 连接 bridge 并进入接收循环；断开后返回以便上层重连。 */
void ws_client_run(void);
bool ws_client_send_text(const char *json);

#endif

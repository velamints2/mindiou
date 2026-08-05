/**
 * Stamp 协议 JSON 解析（cJSON）。薄客户端只识别显示/控制消息，
 * 不解析业务逻辑；messageId 去重避免重复翻页。
 */
#ifndef MINDIOU_PROTOCOL_PARSER_H
#define MINDIOU_PROTOCOL_PARSER_H

#include <stdbool.h>
#include <stdint.h>

typedef enum {
    MSG_UNKNOWN = 0,
    MSG_DISPLAY_TEXT,
    MSG_DISPLAY_CARD,
    MSG_CLEAR_DISPLAY,
    MSG_SET_BRIGHTNESS,
    MSG_PING,
    MSG_ERROR
} server_msg_type_t;

typedef struct {
    server_msg_type_t type;
    char message_id[48];
    char title[64];
    char text[256];
    char body[512];
    char footer[64];
    char card_type[16];
    int page;
    int page_count;
    int value;
} server_msg_t;

/* 解析服务端消息；成功返回 true 并填充 out。非法 JSON / 未知类型返回 false。 */
bool protocol_parse_server(const char *json, server_msg_t *out);

/* messageId 去重：已见过返回 true（调用方仍应回 ACK，但不重复显示）。 */
bool protocol_is_duplicate(const char *message_id);

/* 构造设备→服务端消息。返回静态缓冲区（立即发送，不要长期持有）。 */
const char *protocol_build_hello(const char *device_id, const char *fw_version);
const char *protocol_build_capabilities(void);
const char *protocol_build_ack(const char *message_id);
const char *protocol_build_input(const char *event);
const char *protocol_build_pong(void);
const char *protocol_build_status(int wifi_rssi, uint32_t free_heap);

#endif

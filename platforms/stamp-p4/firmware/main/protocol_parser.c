#include "protocol_parser.h"
#include "cJSON.h"
#include <stdio.h>
#include <string.h>

#define DEDUP_CAP 32

static char s_seen_ids[DEDUP_CAP][48];
static int s_seen_head = 0;
static int s_seen_count = 0;

/* 静态发送缓冲（单次发送，非线程安全，足够薄客户端使用）。 */
static char s_tx[640];

static void copy_str(char *dst, size_t cap, const cJSON *item) {
    if (!dst || cap == 0) return;
    dst[0] = '\0';
    if (cJSON_IsString(item) && item->valuestring) {
        strncpy(dst, item->valuestring, cap - 1);
        dst[cap - 1] = '\0';
    }
}

bool protocol_is_duplicate(const char *message_id) {
    if (!message_id || !message_id[0]) return false;
    for (int i = 0; i < s_seen_count; i++) {
        if (strncmp(s_seen_ids[i], message_id, sizeof(s_seen_ids[i])) == 0) return true;
    }
    /* 记录新 id（环形覆盖最旧）。 */
    strncpy(s_seen_ids[s_seen_head], message_id, sizeof(s_seen_ids[s_seen_head]) - 1);
    s_seen_ids[s_seen_head][sizeof(s_seen_ids[s_seen_head]) - 1] = '\0';
    s_seen_head = (s_seen_head + 1) % DEDUP_CAP;
    if (s_seen_count < DEDUP_CAP) s_seen_count++;
    return false;
}

bool protocol_parse_server(const char *json, server_msg_t *out) {
    if (!json || !out) return false;
    memset(out, 0, sizeof(*out));
    cJSON *root = cJSON_Parse(json);
    if (!root) return false;

    const cJSON *type = cJSON_GetObjectItemCaseSensitive(root, "type");
    if (!cJSON_IsString(type)) { cJSON_Delete(root); return false; }

    copy_str(out->message_id, sizeof(out->message_id), cJSON_GetObjectItemCaseSensitive(root, "messageId"));

    const char *t = type->valuestring;
    if (strcmp(t, "display_text") == 0) {
        out->type = MSG_DISPLAY_TEXT;
        copy_str(out->title, sizeof(out->title), cJSON_GetObjectItemCaseSensitive(root, "title"));
        copy_str(out->text, sizeof(out->text), cJSON_GetObjectItemCaseSensitive(root, "text"));
        const cJSON *page = cJSON_GetObjectItemCaseSensitive(root, "page");
        const cJSON *pc = cJSON_GetObjectItemCaseSensitive(root, "pageCount");
        out->page = cJSON_IsNumber(page) ? page->valueint : 1;
        out->page_count = cJSON_IsNumber(pc) ? pc->valueint : 1;
    } else if (strcmp(t, "display_card") == 0) {
        out->type = MSG_DISPLAY_CARD;
        copy_str(out->card_type, sizeof(out->card_type), cJSON_GetObjectItemCaseSensitive(root, "cardType"));
        copy_str(out->title, sizeof(out->title), cJSON_GetObjectItemCaseSensitive(root, "title"));
        copy_str(out->body, sizeof(out->body), cJSON_GetObjectItemCaseSensitive(root, "body"));
        copy_str(out->footer, sizeof(out->footer), cJSON_GetObjectItemCaseSensitive(root, "footer"));
    } else if (strcmp(t, "clear_display") == 0) {
        out->type = MSG_CLEAR_DISPLAY;
    } else if (strcmp(t, "set_brightness") == 0) {
        out->type = MSG_SET_BRIGHTNESS;
        const cJSON *v = cJSON_GetObjectItemCaseSensitive(root, "value");
        out->value = cJSON_IsNumber(v) ? v->valueint : 128;
    } else if (strcmp(t, "ping") == 0) {
        out->type = MSG_PING;
    } else if (strcmp(t, "error") == 0) {
        out->type = MSG_ERROR;
        copy_str(out->text, sizeof(out->text), cJSON_GetObjectItemCaseSensitive(root, "message"));
    } else {
        cJSON_Delete(root);
        return false;
    }

    cJSON_Delete(root);
    return true;
}

const char *protocol_build_hello(const char *device_id, const char *fw_version) {
    snprintf(s_tx, sizeof(s_tx),
        "{\"type\":\"device_hello\",\"deviceId\":\"%s\",\"firmwareVersion\":\"%s\",\"protocolVersion\":1}",
        device_id ? device_id : "stamp-p4-001", fw_version ? fw_version : "0.1.0");
    return s_tx;
}

const char *protocol_build_capabilities(void) {
    snprintf(s_tx, sizeof(s_tx),
        "{\"type\":\"capabilities\","
        "\"display\":{\"physicalWidth\":1280,\"physicalHeight\":720,\"logicalWidth\":640,\"logicalHeight\":200,\"color\":true,\"scroll\":false},"
        "\"input\":{\"buttons\":true,\"touch\":false,\"voice\":false},"
        "\"camera\":false,\"audio\":false}");
    return s_tx;
}

const char *protocol_build_ack(const char *message_id) {
    snprintf(s_tx, sizeof(s_tx), "{\"type\":\"ack\",\"messageId\":\"%s\"}", message_id ? message_id : "");
    return s_tx;
}

const char *protocol_build_input(const char *event) {
    snprintf(s_tx, sizeof(s_tx), "{\"type\":\"input_event\",\"event\":\"%s\",\"timestamp\":0}", event ? event : "next");
    return s_tx;
}

const char *protocol_build_pong(void) {
    snprintf(s_tx, sizeof(s_tx), "{\"type\":\"pong\",\"timestamp\":0}");
    return s_tx;
}

const char *protocol_build_status(int wifi_rssi, uint32_t free_heap) {
    snprintf(s_tx, sizeof(s_tx),
        "{\"type\":\"device_status\",\"battery\":null,\"wifiRssi\":%d,\"freeHeap\":%lu}",
        wifi_rssi, (unsigned long)free_heap);
    return s_tx;
}

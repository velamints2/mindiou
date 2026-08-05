#include "websocket_client.h"
#include "device_state.h"
#include "display_service.h"
#include "protocol_parser.h"
#include "wifi_client.h"
#include "sdkconfig.h"
#include <string.h>
#include "esp_log.h"
#include "esp_system.h"
#include "esp_websocket_client.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

#define FW_VERSION "0.1.0"

static const char *TAG = "ws";
static esp_websocket_client_handle_t s_client = NULL;
static volatile bool s_connected = false;

static void handle_server_text(const char *data, int len) {
    /* WebSocket 文本帧可能不携带结尾 NUL，复制到本地缓冲。 */
    char buf[1024];
    if (len <= 0 || len >= (int)sizeof(buf)) return;
    memcpy(buf, data, len);
    buf[len] = '\0';

    server_msg_t msg;
    if (!protocol_parse_server(buf, &msg)) {
        ESP_LOGW(TAG, "无法解析的服务端消息");
        return;
    }

    /* 显示类消息：先 ACK，再按 messageId 去重显示。 */
    bool is_display = (msg.type == MSG_DISPLAY_TEXT || msg.type == MSG_DISPLAY_CARD ||
                       msg.type == MSG_CLEAR_DISPLAY || msg.type == MSG_SET_BRIGHTNESS);
    if (is_display && msg.message_id[0]) {
        ws_client_send_text(protocol_build_ack(msg.message_id));
        if (protocol_is_duplicate(msg.message_id)) {
            ESP_LOGI(TAG, "重复 messageId，仅 ACK 不显示");
            return;
        }
    }

    switch (msg.type) {
        case MSG_DISPLAY_TEXT:
            display_show_text(msg.title, msg.text, msg.page, msg.page_count);
            break;
        case MSG_DISPLAY_CARD: {
            card_type_t ct = CARD_TYPE_STATUS;
            if (strcmp(msg.card_type, "question") == 0) ct = CARD_TYPE_QUESTION;
            else if (strcmp(msg.card_type, "feedback") == 0) ct = CARD_TYPE_FEEDBACK;
            else if (strcmp(msg.card_type, "reference") == 0) ct = CARD_TYPE_REFERENCE;
            display_show_card(ct, msg.title, msg.body, msg.footer);
            break;
        }
        case MSG_CLEAR_DISPLAY:
            display_clear();
            break;
        case MSG_SET_BRIGHTNESS:
            display_set_brightness((uint8_t)msg.value);
            break;
        case MSG_PING:
            ws_client_send_text(protocol_build_pong());
            break;
        case MSG_ERROR:
            ESP_LOGW(TAG, "服务端错误: %s", msg.text);
            break;
        default:
            break;
    }
}

static void ws_event_handler(void *arg, esp_event_base_t base, int32_t id, void *data) {
    esp_websocket_event_data_t *ev = (esp_websocket_event_data_t *)data;
    switch (id) {
        case WEBSOCKET_EVENT_CONNECTED:
            s_connected = true;
            device_state_reset_backoff();
            device_state_set(DEV_STATE_WS_CONNECTED);
            ESP_LOGI(TAG, "WebSocket 已连接，发送握手");
            ws_client_send_text(protocol_build_hello(CONFIG_MINDIOU_DEVICE_ID, FW_VERSION));
            ws_client_send_text(protocol_build_capabilities());
            device_state_set(DEV_STATE_WS_READY);
            break;
        case WEBSOCKET_EVENT_DISCONNECTED:
            s_connected = false;
            device_state_set(DEV_STATE_DISCONNECTED);
            display_show_disconnected();
            ESP_LOGW(TAG, "WebSocket 断开");
            break;
        case WEBSOCKET_EVENT_DATA:
            if (ev->op_code == 0x01) { /* 文本帧 */
                handle_server_text((const char *)ev->data_ptr, ev->data_len);
            }
            break;
        case WEBSOCKET_EVENT_ERROR:
            ESP_LOGE(TAG, "WebSocket 错误");
            break;
        default:
            break;
    }
}

bool ws_client_send_text(const char *json) {
    if (!s_client || !s_connected || !json) return false;
    return esp_websocket_client_send_text(s_client, json, strlen(json), pdMS_TO_TICKS(2000)) >= 0;
}

void ws_client_run(void) {
    esp_websocket_client_config_t cfg = {
        .uri = CONFIG_MINDIOU_BRIDGE_URI,
        .reconnect_timeout_ms = CONFIG_MINDIOU_RECONNECT_MAX_MS,
        .network_timeout_ms = 10000,
    };
    s_client = esp_websocket_client_init(&cfg);
    esp_websocket_register_events(s_client, WEBSOCKET_EVENT_ANY, ws_event_handler, NULL);

    device_state_set(DEV_STATE_WS_CONNECTING);
    esp_websocket_client_start(s_client);

    /* 接收循环：连接期间周期性上报状态；断开后退出循环由上层重连。 */
    while (device_state_get() != DEV_STATE_DISCONNECTED) {
        if (device_state_is_ready()) {
            ws_client_send_text(protocol_build_status(wifi_client_rssi(), esp_get_free_heap_size()));
        }
        vTaskDelay(pdMS_TO_TICKS(CONFIG_MINDIOU_PING_INTERVAL_MS));
    }

    esp_websocket_client_stop(s_client);
    esp_websocket_client_destroy(s_client);
    s_client = NULL;
    s_connected = false;
}

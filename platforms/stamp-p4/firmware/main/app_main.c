/**
 * MindIOU Stamp-P4 固件入口（阶段3：网络层 + Mock 显示）。
 * 流程：NVS 初始化 → 显示初始化 → 输入服务 → Wi-Fi → WebSocket 循环（含指数退避重连）。
 * 业务状态机/AI/清偿逻辑全部在服务端，本固件只做显示与输入转发。
 */
#include "device_state.h"
#include "display_service.h"
#include "input_service.h"
#include "websocket_client.h"
#include "wifi_client.h"
#include "esp_log.h"
#include "nvs_flash.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

static const char *TAG = "app";

void app_main(void) {
    /* NVS（Wi-Fi 凭据/校准需要）。 */
    esp_err_t ret = nvs_flash_init();
    if (ret == ESP_ERR_NVS_NO_FREE_PAGES || ret == ESP_ERR_NVS_NEW_VERSION_FOUND) {
        ESP_ERROR_CHECK(nvs_flash_erase());
        ESP_ERROR_CHECK(nvs_flash_init());
    }

    device_state_init();
    display_init();
    input_service_start();
    ESP_LOGI(TAG, "MindIOU Stamp-P4 固件启动（Mock 显示）");

    for (;;) {
        if (!wifi_client_connect()) {
            ESP_LOGW(TAG, "Wi-Fi 连接失败，%ums 后重试", device_state_next_backoff_ms());
            vTaskDelay(pdMS_TO_TICKS(device_state_next_backoff_ms()));
            continue;
        }
        device_state_reset_backoff();

        /* WebSocket 接收循环；断开后返回。 */
        ws_client_run();

        uint32_t wait = device_state_next_backoff_ms();
        ESP_LOGW(TAG, "%ums 后重连 WebSocket", wait);
        vTaskDelay(pdMS_TO_TICKS(wait));
    }
}

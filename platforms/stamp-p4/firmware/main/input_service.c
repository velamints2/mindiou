#include "input_service.h"
#include "protocol_parser.h"
#include "websocket_client.h"
#include "device_state.h"
#include <stdio.h>
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "driver/uart.h"

static const char *TAG = "input";

/* 串口字节 → 设备输入事件。n=next r=repeat f=finish。 */
static const char *map_serial(int c) {
    switch (c) {
        case 'n': case 'N': return "next";
        case 'r': case 'R': return "repeat";
        case 'f': case 'F': return "finish";
        default: return NULL;
    }
}

static void input_task(void *arg) {
    uint8_t ch;
    for (;;) {
        /* 从 UART0 读一个字节（串口监视器输入）。 */
        int len = uart_read_bytes(UART_NUM_0, &ch, 1, pdMS_TO_TICKS(200));
        if (len > 0) {
            const char *event = map_serial(ch);
            if (event) {
                ESP_LOGI(TAG, "串口输入: %s", event);
                if (device_state_is_ready()) {
                    ws_client_send_text(protocol_build_input(event));
                } else {
                    ESP_LOGW(TAG, "未连接，忽略输入");
                }
            }
        }
        /* TODO(hardware)：接真实按键 GPIO 后在此轮询/中断，映射到相同事件名。 */
    }
}

void input_service_start(void) {
    xTaskCreate(input_task, "input", 3072, NULL, 5, NULL);
}

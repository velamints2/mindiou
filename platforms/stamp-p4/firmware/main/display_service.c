#include "display_service.h"
#include "sdkconfig.h"
#include <stdio.h>
#include "esp_log.h"

static const char *TAG = "display";

#ifdef CONFIG_MINDIOU_DISPLAY_MOCK

/* ---- MockDisplayBackend：串口日志 ---- */
static const char *card_type_name(card_type_t t) {
    switch (t) {
        case CARD_TYPE_QUESTION: return "question";
        case CARD_TYPE_FEEDBACK: return "feedback";
        case CARD_TYPE_REFERENCE: return "reference";
        default: return "status";
    }
}

void display_init(void) { ESP_LOGI(TAG, "Mock 显示后端就绪（串口日志）"); }

void display_show_text(const char *title, const char *text, int page, int page_count) {
    printf("\n===== [640x200] %s =====\n%s\n", title ? title : "", text ? text : "");
    if (page_count > 1) printf("----- 第 %d/%d 页 -----\n", page, page_count);
    fflush(stdout);
}

void display_show_card(card_type_t type, const char *title, const char *body, const char *footer) {
    printf("\n===== [%s] %s =====\n%s\n", card_type_name(type), title ? title : "", body ? body : "");
    if (footer && footer[0]) printf("----- %s -----\n", footer);
    fflush(stdout);
}

void display_clear(void) { printf("\n===== [清屏] =====\n"); fflush(stdout); }
void display_set_brightness(uint8_t value) { ESP_LOGI(TAG, "亮度 %u（Mock 无效）", value); }
void display_show_disconnected(void) {
    printf("\n===== [状态] 连接已断开 =====\n正在重连…\n");
    fflush(stdout);
}

#elif defined(CONFIG_MINDIOU_DISPLAY_MIPI_DSI)

/* ---- StampP4DsiDisplayBackend：真实 MIPI DSI ----
 * TODO(hardware)：以下资料齐全前不得实现/启用，禁止猜测参数：
 * - Stamp-P4 完整 DSI Pin 定义
 * - 驱动板 35Pin 完整 Pin 定义
 * - OVP0921 MIPI 输入 Pin 定义 / 时序 / 电压域 / RESET 与 I2C 要求
 * - 实际转接 PCB
 */
#error "MIPI DSI 显示后端尚未实现：缺少 OVP0921 资料，见 display_service.c TODO"

void display_init(void) {}
void display_show_text(const char *t, const char *x, int p, int c) { (void)t;(void)x;(void)p;(void)c; }
void display_show_card(card_type_t t, const char *ti, const char *b, const char *f) { (void)t;(void)ti;(void)b;(void)f; }
void display_clear(void) {}
void display_set_brightness(uint8_t v) { (void)v; }
void display_show_disconnected(void) {}

#else
#error "必须选择 CONFIG_MINDIOU_DISPLAY_MOCK 或 CONFIG_MINDIOU_DISPLAY_MIPI_DSI"
#endif

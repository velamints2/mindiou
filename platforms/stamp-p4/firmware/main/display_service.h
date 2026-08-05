/**
 * 统一显示接口。第一版两个后端：
 * - MockDisplayBackend（CONFIG_MINDIOU_DISPLAY_MOCK）：输出到串口日志
 * - StampP4DsiDisplayBackend（CONFIG_MINDIOU_DISPLAY_MIPI_DSI）：真实 MIPI，资料不全前不启用
 *
 * 逻辑内容区 640×200，居中于 1280×720 物理画布，白字黑底，无滚动无动画。
 */
#ifndef MINDIOU_DISPLAY_SERVICE_H
#define MINDIOU_DISPLAY_SERVICE_H

#include <stdint.h>

typedef enum {
    CARD_TYPE_QUESTION = 0,
    CARD_TYPE_FEEDBACK,
    CARD_TYPE_REFERENCE,
    CARD_TYPE_STATUS
} card_type_t;

void display_init(void);
void display_show_text(const char *title, const char *text, int page, int page_count);
void display_show_card(card_type_t type, const char *title, const char *body, const char *footer);
void display_clear(void);
void display_set_brightness(uint8_t value);
/* 断线提示（整屏替换）。 */
void display_show_disconnected(void);

#endif

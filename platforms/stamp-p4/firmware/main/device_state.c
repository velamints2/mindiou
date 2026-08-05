#include "device_state.h"
#include "sdkconfig.h"

static device_state_t s_state = DEV_STATE_BOOT;
static uint32_t s_backoff_ms = 1000;

#ifndef CONFIG_MINDIOU_RECONNECT_MAX_MS
#define CONFIG_MINDIOU_RECONNECT_MAX_MS 30000
#endif

void device_state_init(void) {
    s_state = DEV_STATE_BOOT;
    s_backoff_ms = 1000;
}

void device_state_set(device_state_t state) { s_state = state; }
device_state_t device_state_get(void) { return s_state; }

bool device_state_is_ready(void) { return s_state == DEV_STATE_WS_READY; }

uint32_t device_state_next_backoff_ms(void) {
    uint32_t wait = s_backoff_ms;
    s_backoff_ms *= 2;
    if (s_backoff_ms > CONFIG_MINDIOU_RECONNECT_MAX_MS) {
        s_backoff_ms = CONFIG_MINDIOU_RECONNECT_MAX_MS;
    }
    return wait;
}

void device_state_reset_backoff(void) { s_backoff_ms = 1000; }

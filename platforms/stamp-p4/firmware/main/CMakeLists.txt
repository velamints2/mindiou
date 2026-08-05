idf_component_register(
  SRCS
    "app_main.c"
    "wifi_client.c"
    "websocket_client.c"
    "protocol_parser.c"
    "display_service.c"
    "input_service.c"
    "device_state.c"
  INCLUDE_DIRS "."
  REQUIRES esp_event esp_netif esp_wifi nvs_flash esp_websocket_client json driver
)

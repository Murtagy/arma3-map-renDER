/**
 * Node.js N-API addon for LZO1X decompression that returns bytes consumed.
 * Uses a patched minilzo that exposes lzo1x_last_consumed after decompress.
 */
#include <node_api.h>
#include <string.h>
#include <stdlib.h>
#include "minilzo.h"

/* Defined in patched minilzo.c - set at eof_found to (ip - in) */
extern lzo_uint lzo1x_last_consumed;

/**
 * decompress(inputBuffer, expectedOutputSize) -> { data: Buffer, bytesRead: number }
 */
static napi_value Decompress(napi_env env, napi_callback_info info) {
    size_t argc = 2;
    napi_value args[2];
    napi_get_cb_info(env, info, &argc, args, NULL, NULL);

    /* Get input buffer */
    void *input_data;
    size_t input_len;
    napi_get_buffer_info(env, args[0], &input_data, &input_len);

    /* Get expected output size */
    int64_t expected_size;
    napi_get_value_int64(env, args[1], &expected_size);

    /* Allocate output buffer */
    unsigned char *output = (unsigned char *)malloc(expected_size);
    if (!output) {
        napi_throw_error(env, NULL, "Failed to allocate output buffer");
        return NULL;
    }

    /* Single decompress call - minilzo sets lzo1x_last_consumed */
    lzo_uint out_len = (lzo_uint)expected_size;
    lzo1x_last_consumed = 0;
    int r = lzo1x_decompress_safe(
        (const lzo_bytep)input_data, (lzo_uint)input_len,
        output, &out_len, NULL
    );

    if (r != LZO_E_OK && r != LZO_E_INPUT_NOT_CONSUMED) {
        free(output);
        napi_throw_error(env, NULL, "LZO decompression failed");
        return NULL;
    }

    lzo_uint consumed = lzo1x_last_consumed;

    /* Create result object { data: Buffer, bytesRead: number } */
    napi_value result_obj;
    napi_create_object(env, &result_obj);

    /* Create output buffer (copy data) */
    napi_value output_buf;
    void *output_copy;
    napi_create_buffer_copy(env, out_len, output, &output_copy, &output_buf);
    napi_set_named_property(env, result_obj, "data", output_buf);

    /* Set bytesRead */
    napi_value bytes_read;
    napi_create_int64(env, (int64_t)consumed, &bytes_read);
    napi_set_named_property(env, result_obj, "bytesRead", bytes_read);

    free(output);
    return result_obj;
}

/**
 * skipDecompress(inputBuffer, expectedOutputSize) -> number (bytesRead)
 * Decompresses only to find compressed size, discards output.
 */
static napi_value SkipDecompress(napi_env env, napi_callback_info info) {
    size_t argc = 2;
    napi_value args[2];
    napi_get_cb_info(env, info, &argc, args, NULL, NULL);

    void *input_data;
    size_t input_len;
    napi_get_buffer_info(env, args[0], &input_data, &input_len);

    int64_t expected_size;
    napi_get_value_int64(env, args[1], &expected_size);

    unsigned char *output = (unsigned char *)malloc(expected_size);
    if (!output) {
        napi_throw_error(env, NULL, "Failed to allocate output buffer");
        return NULL;
    }

    lzo_uint out_len = (lzo_uint)expected_size;
    lzo1x_last_consumed = 0;
    int r = lzo1x_decompress_safe(
        (const lzo_bytep)input_data, (lzo_uint)input_len,
        output, &out_len, NULL
    );
    free(output);

    if (r != LZO_E_OK && r != LZO_E_INPUT_NOT_CONSUMED) {
        napi_throw_error(env, NULL, "LZO decompression failed");
        return NULL;
    }

    napi_value result;
    napi_create_int64(env, (int64_t)lzo1x_last_consumed, &result);
    return result;
}

static napi_value Init(napi_env env, napi_value exports) {
    lzo_init();

    napi_value fn;
    napi_create_function(env, "decompress", NAPI_AUTO_LENGTH, Decompress, NULL, &fn);
    napi_set_named_property(env, exports, "decompress", fn);

    napi_value fn2;
    napi_create_function(env, "skipDecompress", NAPI_AUTO_LENGTH, SkipDecompress, NULL, &fn2);
    napi_set_named_property(env, exports, "skipDecompress", fn2);

    return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)

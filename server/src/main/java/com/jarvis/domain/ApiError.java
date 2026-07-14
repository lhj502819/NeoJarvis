package com.jarvis.domain;

/**
 * Error response body. Field name {@code error} matches the TS routes'
 * {@code { error: "..." }} shape (e.g. 404 "任务不存在").
 */
public record ApiError(String error) {
}

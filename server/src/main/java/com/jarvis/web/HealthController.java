package com.jarvis.web;

import java.util.Map;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api")
public class HealthController {

    private final JdbcTemplate jdbcTemplate;

    public HealthController(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    @GetMapping("/health")
    public Map<String, String> health() {
        return Map.of(
                "status", "ok",
                "service", "jarvis-server",
                "version", "0.3.0"
        );
    }

    @GetMapping("/health/db")
    public Map<String, Object> healthDb() {
        Integer count = jdbcTemplate.queryForObject("SELECT COUNT(*) FROM jarvis_users", Integer.class);
        return Map.of("status", "ok", "users_count", count == null ? 0 : count);
    }
}

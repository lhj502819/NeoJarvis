package com.jarvis.web;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import jakarta.servlet.http.Cookie;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;

/**
 * Auth with dev-bypass OFF (prod-like): a missing/invalid token on a protected endpoint
 * yields 401 {@code {"error":"未登录"}}, while a valid cookie is honoured. Public paths
 * (register/login) stay open so an account can still be bootstrapped.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@TestPropertySource(properties = "jarvis.auth.dev-bypass=false")
@Transactional
class AuthSecurityBypassOffIntegrationTest {

    @Autowired
    private MockMvc mockMvc;

    @Test
    void protectedEndpointWithoutTokenReturns401() throws Exception {
        mockMvc.perform(get("/api/auth/me"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.error").value("未登录"));
    }

    @Test
    void anotherProtectedEndpointWithoutTokenReturns401() throws Exception {
        mockMvc.perform(get("/api/tasks"))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void invalidTokenReturns401() throws Exception {
        mockMvc.perform(get("/api/auth/me").cookie(new Cookie("jarvis_token", "garbage")))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void validCookieFromRegisterGrantsAccess() throws Exception {
        Cookie cookie = mockMvc.perform(post("/api/auth/register")
                        .contentType("application/json").content("""
                        {"username":"dave","password":"pw"}
                        """))
                .andExpect(status().isOk())
                .andReturn().getResponse().getCookie("jarvis_token");

        mockMvc.perform(get("/api/auth/me").cookie(cookie))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.username").value("dave"));
    }
}

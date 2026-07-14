package com.jarvis.web;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.cookie;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import jakarta.servlet.http.Cookie;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;

/**
 * End-to-end auth over the real security chain + H2. {@code @Transactional} rolls each
 * method back, so every test sees an empty {@code jarvis_users} (its registered user is
 * therefore the first -> admin) and nothing leaks into other test classes' shared DB.
 * Dev-bypass is on here (the {@code application.yml} default).
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@Transactional
class AuthIntegrationTest {

    @Autowired
    private MockMvc mockMvc;

    @Test
    void registerThenLoginThenMeCarriesTheSameUserViaCookie() throws Exception {
        // Register -> issues an httpOnly jarvis_token cookie for the first (admin) user.
        Cookie regCookie = mockMvc.perform(post("/api/auth/register")
                        .contentType("application/json").content("""
                        {"username":"alice","password":"pw","displayName":"Alice"}
                        """))
                .andExpect(status().isOk())
                .andExpect(cookie().exists("jarvis_token"))
                .andExpect(cookie().httpOnly("jarvis_token", true))
                .andExpect(jsonPath("$.role").value("admin"))
                .andReturn().getResponse().getCookie("jarvis_token");
        assertThat(regCookie).isNotNull();

        // Login returns a fresh cookie too.
        Cookie loginCookie = mockMvc.perform(post("/api/auth/login")
                        .contentType("application/json").content("""
                        {"username":"alice","password":"pw"}
                        """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.username").value("alice"))
                .andReturn().getResponse().getCookie("jarvis_token");

        // /me with the cookie resolves back to alice.
        mockMvc.perform(get("/api/auth/me").cookie(loginCookie))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.username").value("alice"))
                .andExpect(jsonPath("$.role").value("admin"));
    }

    @Test
    void wrongPasswordReturns401() throws Exception {
        mockMvc.perform(post("/api/auth/register").contentType("application/json").content("""
                {"username":"bob","password":"right"}
                """)).andExpect(status().isOk());

        mockMvc.perform(post("/api/auth/login").contentType("application/json").content("""
                {"username":"bob","password":"wrong"}
                """))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.error").value("用户名或密码错误"));
    }

    @Test
    void duplicateUsernameReturns400() throws Exception {
        mockMvc.perform(post("/api/auth/register").contentType("application/json").content("""
                {"username":"carol","password":"pw"}
                """)).andExpect(status().isOk());

        mockMvc.perform(post("/api/auth/register").contentType("application/json").content("""
                {"username":"carol","password":"pw"}
                """))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error").value("用户名已存在"));
    }

    @Test
    void devBypassInjectsLocalOnProtectedEndpointWithoutToken() throws Exception {
        // dev-bypass on -> no cookie still resolves to the local user (200, not 401).
        mockMvc.perform(get("/api/auth/me"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.userId").value("local"));
    }

    @Test
    void tamperedTokenIsRejectedThenBypassedToLocal() throws Exception {
        // A bad token is ignored; dev-bypass then falls back to local (still 200).
        mockMvc.perform(get("/api/auth/me").cookie(new Cookie("jarvis_token", "bad.token.xyz")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.userId").value("local"));
    }
}

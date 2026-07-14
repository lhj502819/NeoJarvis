package com.jarvis.web;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.cookie;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.jarvis.auth.JwtService;
import com.jarvis.domain.AuthResponse;
import com.jarvis.service.AuthService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.context.annotation.Import;
import org.springframework.test.web.servlet.MockMvc;

/**
 * Controller-slice test with filters disabled (security is exercised in the integration
 * test). Uses a real {@link JwtService} to prove a genuine {@code jarvis_token} cookie is
 * signed on register/login.
 */
@AutoConfigureMockMvc(addFilters = false)
@WebMvcTest(AuthController.class)
@Import(JwtService.class)
class AuthControllerTest {

    @Autowired
    private MockMvc mockMvc;
    @MockBean
    private AuthService authService;

    private static final AuthResponse ALICE =
            new AuthResponse("u1", "alice", "Alice", "admin");

    @Test
    void registerSignsTokenCookieAndReturnsUser() throws Exception {
        when(authService.register(eq("alice"), any(), eq("pw"), any())).thenReturn(ALICE);

        mockMvc.perform(post("/api/auth/register").contentType("application/json").content("""
                {"username":"alice","password":"pw","displayName":"Alice"}
                """))
                .andExpect(status().isOk())
                .andExpect(cookie().exists("jarvis_token"))
                .andExpect(cookie().httpOnly("jarvis_token", true))
                .andExpect(jsonPath("$.userId").value("u1"))
                .andExpect(jsonPath("$.username").value("alice"))
                .andExpect(jsonPath("$.passwordHash").doesNotExist());
    }

    @Test
    void loginSignsCookie() throws Exception {
        when(authService.login("alice", "pw")).thenReturn(ALICE);

        mockMvc.perform(post("/api/auth/login").contentType("application/json").content("""
                {"username":"alice","password":"pw"}
                """))
                .andExpect(status().isOk())
                .andExpect(cookie().exists("jarvis_token"))
                .andExpect(jsonPath("$.username").value("alice"));
    }

    @Test
    void loginWithBadPasswordReturns401() throws Exception {
        when(authService.login("alice", "bad"))
                .thenThrow(new UnauthorizedException("用户名或密码错误"));

        mockMvc.perform(post("/api/auth/login").contentType("application/json").content("""
                {"username":"alice","password":"bad"}
                """))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.error").value("用户名或密码错误"));
    }

    @Test
    void registerMissingFieldsIsBadRequest() throws Exception {
        mockMvc.perform(post("/api/auth/register").contentType("application/json")
                        .content("{\"username\":\"alice\"}"))
                .andExpect(status().isBadRequest());
    }

    @Test
    void meReturnsCurrentUser() throws Exception {
        // Filters disabled -> UserContext falls back to "local".
        when(authService.currentUser("local", "local"))
                .thenReturn(new AuthResponse("local", "local", "local", "user"));

        mockMvc.perform(get("/api/auth/me"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.userId").value("local"))
                .andExpect(jsonPath("$.role").value("user"));
    }

    @Test
    void logoutClearsCookie() throws Exception {
        mockMvc.perform(post("/api/auth/logout"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.ok").value(true))
                .andExpect(header().string("Set-Cookie", org.hamcrest.Matchers.containsString(
                        "jarvis_token=;")));
    }
}

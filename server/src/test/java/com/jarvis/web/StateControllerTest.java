package com.jarvis.web;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.jarvis.domain.JarvisState;
import com.jarvis.domain.StatePatchRequest;
import com.jarvis.service.StateService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

@AutoConfigureMockMvc(addFilters = false)
@WebMvcTest(StateController.class)
class StateControllerTest {

    @Autowired
    private MockMvc mockMvc;
    @MockBean
    private StateService stateService;

    @Test
    void getStateReturnsDefaultsShape() throws Exception {
        when(stateService.getState("local"))
                .thenReturn(new JarvisState(80, 90, 70, 0, 0, "", "2026-07-14", 50, 45));

        mockMvc.perform(get("/api/state"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.mood").value(80))
                .andExpect(jsonPath("$.energy").value(90))
                .andExpect(jsonPath("$.confidence").value(70))
                .andExpect(jsonPath("$.familiarity").value(50))
                .andExpect(jsonPath("$.trustLevel").value(45));
    }

    @Test
    void patchStateReturnsUpdatedState() throws Exception {
        when(stateService.patchState(eq("local"), any(StatePatchRequest.class)))
                .thenReturn(new JarvisState(80, 20, 70, 0, 0, "", "2026-07-14", 50, 99));

        mockMvc.perform(patch("/api/state")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"energy\":20,\"trustLevel\":99}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.energy").value(20))
                .andExpect(jsonPath("$.trustLevel").value(99));
    }
}

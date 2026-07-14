package com.jarvis.web;

import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.jarvis.domain.SkillPrefsResponse;
import com.jarvis.service.SkillPrefsService;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.test.web.servlet.MockMvc;

@AutoConfigureMockMvc(addFilters = false)
@WebMvcTest(SkillController.class)
class SkillControllerTest {

    @Autowired
    private MockMvc mockMvc;
    @MockBean
    private SkillPrefsService skillPrefsService;

    @Test
    void prefsReturnsDisabledList() throws Exception {
        when(skillPrefsService.getDisabled("local"))
                .thenReturn(new SkillPrefsResponse(List.of("baoyu-comic")));

        mockMvc.perform(get("/api/skills/prefs"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.disabled[0]").value("baoyu-comic"));
    }

    @Test
    void toggleAppliesEnabledFlagAndReturnsOk() throws Exception {
        mockMvc.perform(post("/api/skills/deep-research/toggle")
                        .contentType("application/json").content("{\"enabled\":false}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.ok").value(true));

        verify(skillPrefsService).setEnabled("local", "deep-research", false);
    }

    @Test
    void toggleRejectsMissingEnabledFlag() throws Exception {
        mockMvc.perform(post("/api/skills/deep-research/toggle")
                        .contentType("application/json").content("{}"))
                .andExpect(status().isBadRequest());
    }
}

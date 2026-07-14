package com.jarvis.web;

import com.jarvis.auth.UserContext;
import com.jarvis.domain.OkResponse;
import com.jarvis.domain.SkillPrefsResponse;
import com.jarvis.domain.SkillToggleRequest;
import com.jarvis.service.SkillPrefsService;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/skills")
class SkillController {

    private final SkillPrefsService skillPrefsService;

    SkillController(SkillPrefsService skillPrefsService) {
        this.skillPrefsService = skillPrefsService;
    }

    /** GET /api/skills/prefs — {@code { disabled: [...] }} (user's disabled skill names). */
    @GetMapping("/prefs")
    SkillPrefsResponse prefs() {
        return skillPrefsService.getDisabled(UserContext.currentUserId());
    }

    /** POST /api/skills/{name}/toggle — enable/disable a skill, returns {@code {ok:true}}. */
    @PostMapping("/{name}/toggle")
    OkResponse toggle(@PathVariable String name, @Valid @RequestBody SkillToggleRequest request) {
        skillPrefsService.setEnabled(UserContext.currentUserId(), name, request.enabled());
        return new OkResponse(true);
    }
}

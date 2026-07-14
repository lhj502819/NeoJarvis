package com.jarvis.web;

import com.jarvis.auth.UserContext;
import com.jarvis.domain.JarvisState;
import com.jarvis.domain.StatePatchRequest;
import com.jarvis.service.StateService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/state")
class StateController {

    private final StateService stateService;

    StateController(StateService stateService) {
        this.stateService = stateService;
    }

    /** GET /api/state — current persona state (defaults when no record). */
    @GetMapping
    JarvisState state() {
        return stateService.getState(UserContext.currentUserId());
    }

    /** PATCH /api/state — apply only the provided fields, return the updated state. */
    @PatchMapping
    JarvisState patch(@RequestBody StatePatchRequest request) {
        return stateService.patchState(UserContext.currentUserId(), request);
    }
}

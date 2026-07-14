package com.jarvis.service;

import com.jarvis.domain.SkillPrefsResponse;
import com.jarvis.mapper.SkillPrefsMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Skill enable/disable preferences (ports src/jarvis/skill-prefs.ts). The server owns
 * only the blacklist table — it does NOT scan local skills (client responsibility,
 * spec §11). Enabling removes the row; disabling inserts it idempotently.
 */
@Service
public class SkillPrefsService {

    private static final Logger log = LoggerFactory.getLogger(SkillPrefsService.class);

    private final SkillPrefsMapper skillPrefsMapper;

    public SkillPrefsService(SkillPrefsMapper skillPrefsMapper) {
        this.skillPrefsMapper = skillPrefsMapper;
    }

    @Transactional(readOnly = true)
    public SkillPrefsResponse getDisabled(String userId) {
        log.debug("get_skill_prefs userId={}", userId);
        return new SkillPrefsResponse(skillPrefsMapper.listDisabled(userId));
    }

    @Transactional
    public void setEnabled(String userId, String name, boolean enabled) {
        if (enabled) {
            skillPrefsMapper.delete(userId, name);
        } else {
            skillPrefsMapper.insertIgnore(userId, name);
        }
        log.debug("set_skill_enabled userId={} name={} enabled={}", userId, name, enabled);
    }
}

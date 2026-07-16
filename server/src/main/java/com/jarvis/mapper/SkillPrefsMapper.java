package com.jarvis.mapper;

import java.util.List;
import org.apache.ibatis.annotations.Delete;
import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

/**
 * Skill-preference blacklist (ports src/jarvis/skill-prefs.ts). A row means the user
 * disabled that skill. {@link #insertIgnore} uses PostgreSQL
 * {@code INSERT ... ON CONFLICT DO NOTHING} so re-disabling an already-disabled skill is
 * idempotent against the (user_id, skill_name) primary key.
 */
@Mapper
public interface SkillPrefsMapper {

    @Select("SELECT skill_name FROM jarvis_skill_prefs WHERE user_id = #{userId}")
    List<String> listDisabled(@Param("userId") String userId);

    @Insert("INSERT INTO jarvis_skill_prefs (user_id, skill_name) "
            + "VALUES (#{userId}, #{name}) ON CONFLICT DO NOTHING")
    void insertIgnore(@Param("userId") String userId, @Param("name") String name);

    @Delete("DELETE FROM jarvis_skill_prefs WHERE user_id = #{userId} AND skill_name = #{name}")
    void delete(@Param("userId") String userId, @Param("name") String name);
}

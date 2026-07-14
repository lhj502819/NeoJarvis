package com.jarvis.mapper;

import com.jarvis.domain.JarvisState;
import java.util.Optional;
import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.annotations.Update;

@Mapper
public interface StateMapper {

    // Explicit columns ordered to match the JarvisState constructor (user_id excluded),
    // with AS aliases so mapping never depends on SELECT * ordering (CRITICAL-1 / IMPORTANT-2).
    @Select("""
            SELECT mood, energy, confidence,
                   tasks_completed_today AS tasksCompletedToday,
                   messages_handled_today AS messagesHandledToday,
                   last_interaction_at AS lastInteractionAt, last_day_reset AS lastDayReset,
                   familiarity, trust_level AS trustLevel
            FROM jarvis_state WHERE user_id = #{userId}
            """)
    Optional<JarvisState> findByUserId(@Param("userId") String userId);

    @Insert("""
            INSERT INTO jarvis_state
              (user_id, mood, energy, confidence, tasks_completed_today, messages_handled_today,
               last_interaction_at, last_day_reset, familiarity, trust_level)
            VALUES
              (#{userId}, #{s.mood}, #{s.energy}, #{s.confidence}, #{s.tasksCompletedToday},
               #{s.messagesHandledToday}, #{s.lastInteractionAt}, #{s.lastDayReset},
               #{s.familiarity}, #{s.trustLevel})
            """)
    void insert(@Param("userId") String userId, @Param("s") JarvisState s);

    @Update("""
            UPDATE jarvis_state SET
              mood = #{s.mood}, energy = #{s.energy}, confidence = #{s.confidence},
              tasks_completed_today = #{s.tasksCompletedToday},
              messages_handled_today = #{s.messagesHandledToday},
              last_interaction_at = #{s.lastInteractionAt}, last_day_reset = #{s.lastDayReset},
              familiarity = #{s.familiarity}, trust_level = #{s.trustLevel}
            WHERE user_id = #{userId}
            """)
    void update(@Param("userId") String userId, @Param("s") JarvisState s);
}

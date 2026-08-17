-- recordChallengeJudgment uses INSERT ... ON CONFLICT DO UPDATE.
grant update on table private.challenge_judgments to judge_worker;

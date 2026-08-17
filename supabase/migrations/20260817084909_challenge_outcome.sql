create type api.challenge_outcome as enum ('SUCCESS', 'UPHELD');

alter table api.messages
  add column challenge_outcome api.challenge_outcome;

update api.messages messages
set challenge_outcome = case
  when challenges.resolved_verdict is distinct from judgments.original_verdict
    or challenges.resolved_covered_key_point_ids is distinct from judgments.original_covered_key_point_ids
    then 'SUCCESS'::api.challenge_outcome
  else 'UPHELD'::api.challenge_outcome
end
from private.message_challenges challenges
join private.question_judgments judgments on judgments.message_id = challenges.message_id
where messages.id = challenges.message_id
  and messages.challenge_status = 'RESOLVED';

alter table api.messages
  add constraint messages_challenge_outcome_consistent check (
    (challenge_status = 'RESOLVED' and challenge_outcome is not null)
    or (challenge_status <> 'RESOLVED' and challenge_outcome is null)
  );

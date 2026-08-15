-- Keep the trusted web role limited to the public challenge state columns.
revoke update on table api.messages from game_web;
grant update (challenge_status, updated_at) on table api.messages to game_web;

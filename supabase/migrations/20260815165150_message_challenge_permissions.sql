-- Challenge eligibility is checked by the trusted web transaction using only
-- the immutable judgment metadata. Hidden verdict/coverage values are never
-- returned by a public route.
grant select on table private.question_judgments to game_web;

create policy question_judgments_game_web_select
  on private.question_judgments for select to game_web using (true);

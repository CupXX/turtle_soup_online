-- A resolved challenge rebuilds the first-claim ledger from all judgments.
grant delete on table private.key_point_claims to judge_worker;

create policy claims_judge_worker_delete
  on private.key_point_claims for delete to judge_worker using (true);

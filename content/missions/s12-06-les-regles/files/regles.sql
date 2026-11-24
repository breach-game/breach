-- Coup de main: row rules for the Socle database. Written by Bricole on 2029-11-02, "to move on".
alter table profils enable row level security;
create policy "read profiles" on profils for select using (true);
alter table demandes enable row level security;
create policy "read requests" on demandes for select using (true);
create policy "post requests" on demandes for insert with check (true);
-- coffre: service role only. No policy, so the public key reads nothing.
alter table coffre enable row level security;

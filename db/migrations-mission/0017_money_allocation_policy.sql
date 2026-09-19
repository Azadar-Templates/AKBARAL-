-- Owner opt-in standing allocation. Zero disables automatic allocation.
ALTER TABLE mission_money_grants ADD COLUMN auto_allocate_cents INTEGER NOT NULL DEFAULT 0 CHECK (auto_allocate_cents >= 0);

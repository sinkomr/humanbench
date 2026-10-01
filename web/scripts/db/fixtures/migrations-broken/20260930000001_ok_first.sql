-- TEST FIXTURE: succeeds; the next file fails, so a failed build must not leave this one behind.
create table public.before_the_error (id int);
